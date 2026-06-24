#![no_std]
//! Open resolver registry for the OverSync bridge.
//!
//! Resolvers stake a configurable amount of a chosen token to become
//! eligible to fill swap orders. Misbehaving resolvers can be slashed
//! by the registry admin (a contract role intended to be moved to a
//! DAO / multisig). Slashed funds go to a configurable beneficiary
//! (typically a community treasury).
//!
//! This contract intentionally does NOT make access-control decisions
//! for the HTLC itself — the HTLC is correct without the registry
//! (funds are always locked by hashlock + timelock). The registry is
//! a coordination layer: it lets the off-chain order book know which
//! resolvers have skin in the game.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, token, Address, Env, Symbol, Vec,
};

#[cfg(test)]
mod test;

/// Ledger threshold below which instance storage TTL is extended on initialize.
const INSTANCE_TTL_THRESHOLD: u32 = 50_000;
/// Target TTL (in ledgers) for instance storage after an extend (~14 days at 5 s/ledger).
const INSTANCE_TTL_TARGET: u32 = 100_000;

/// Ledger threshold below which a persistent resolver entry TTL is extended.
/// Applied on every write (register, increase_stake, slash) so resolver records
/// used by the HTLC `is_active` check never expire unexpectedly.
pub(crate) const RESOLVER_TTL_THRESHOLD: u32 = 50_000;
/// Target TTL (in ledgers) for persistent resolver entries after an extend.
pub(crate) const RESOLVER_TTL_TARGET: u32 = 100_000;

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialised = 1,
    NotInitialised = 2,
    Unauthorized = 3,
    ResolverNotFound = 4,
    StakeBelowMinimum = 5,
    InvalidAmount = 6,
    AlreadyRegistered = 7,
    Overflow = 8,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ResolverInfo {
    pub address: Address,
    pub stake: i128,
    pub registered_at: u64,
    pub last_slash_at: u64,
    pub total_slashed: i128,
    pub active: bool,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    StakeAsset,
    MinStake,
    SlashBeneficiary,
    Resolver(Address),
    ResolverList,
}

fn topic_registered() -> Symbol { symbol_short!("register") }
fn topic_increased() -> Symbol { symbol_short!("increase") }
fn topic_unregistered() -> Symbol { symbol_short!("unreg") }
fn topic_slashed() -> Symbol { symbol_short!("slashed") }

#[contract]
pub struct ResolverRegistry;

#[contractimpl]
impl ResolverRegistry {
    pub fn initialize(
        env: Env,
        admin: Address,
        stake_asset: Address,
        min_stake: i128,
        slash_beneficiary: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialised);
        }
        if min_stake < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::StakeAsset, &stake_asset);
        env.storage().instance().set(&DataKey::MinStake, &min_stake);
        env.storage().instance().set(&DataKey::SlashBeneficiary, &slash_beneficiary);
        env.storage()
            .instance()
            .set(&DataKey::ResolverList, &Vec::<Address>::new(&env));
        env.storage().instance().extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_TARGET);
    }

    /// Register `resolver` by transferring `stake` from `resolver` into
    /// the contract. The resolver must `require_auth` on the call.
    pub fn register(env: Env, resolver: Address, stake: i128) {
        Self::require_initialised(&env);
        resolver.require_auth();
        let min_stake: i128 = env.storage().instance().get(&DataKey::MinStake).unwrap_or(0);
        if stake < min_stake {
            panic_with_error!(&env, Error::StakeBelowMinimum);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Resolver(resolver.clone()))
        {
            panic_with_error!(&env, Error::AlreadyRegistered);
        }
        let asset: Address = env.storage().instance().get(&DataKey::StakeAsset).unwrap();
        token::Client::new(&env, &asset).transfer(
            &resolver,
            &env.current_contract_address(),
            &stake,
        );
        let info = ResolverInfo {
            address: resolver.clone(),
            stake,
            registered_at: env.ledger().timestamp(),
            last_slash_at: 0,
            total_slashed: 0,
            active: true,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Resolver(resolver.clone()), &info);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Resolver(resolver.clone()), RESOLVER_TTL_THRESHOLD, RESOLVER_TTL_TARGET);

        let mut list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ResolverList)
            .unwrap_or_else(|| Vec::new(&env));
        list.push_back(resolver.clone());
        env.storage().instance().set(&DataKey::ResolverList, &list);

        env.events()
            .publish((topic_registered(), resolver), (stake,));
    }

    /// Add more stake to an existing resolver.
    pub fn increase_stake(env: Env, resolver: Address, additional: i128) {
        Self::require_initialised(&env);
        resolver.require_auth();
        if additional <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let mut info: ResolverInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Resolver(resolver.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, Error::ResolverNotFound));
        let asset: Address = env.storage().instance().get(&DataKey::StakeAsset).unwrap();
        token::Client::new(&env, &asset).transfer(
            &resolver,
            &env.current_contract_address(),
            &additional,
        );
        info.stake = info
            .stake
            .checked_add(additional)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        env.storage()
            .persistent()
            .set(&DataKey::Resolver(resolver.clone()), &info);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Resolver(resolver.clone()), RESOLVER_TTL_THRESHOLD, RESOLVER_TTL_TARGET);
        env.events()
            .publish((topic_increased(), resolver), (additional,));
    }

    /// Withdraw all stake and remove the resolver from the active list.
    pub fn unregister(env: Env, resolver: Address) {
        Self::require_initialised(&env);
        resolver.require_auth();
        let info: ResolverInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Resolver(resolver.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, Error::ResolverNotFound));
        let asset: Address = env.storage().instance().get(&DataKey::StakeAsset).unwrap();
        token::Client::new(&env, &asset).transfer(
            &env.current_contract_address(),
            &resolver,
            &info.stake,
        );
        env.storage()
            .persistent()
            .remove(&DataKey::Resolver(resolver.clone()));
        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ResolverList)
            .unwrap_or_else(|| Vec::new(&env));
        let mut new_list = Vec::new(&env);
        for addr in list.iter() {
            if addr != resolver {
                new_list.push_back(addr);
            }
        }
        env.storage()
            .instance()
            .set(&DataKey::ResolverList, &new_list);
        env.events()
            .publish((topic_unregistered(), resolver), (info.stake,));
    }

    /// Slash a misbehaving resolver. `amount` is taken from their stake
    /// and transferred to the configured `slash_beneficiary`.
    pub fn slash(env: Env, resolver: Address, amount: i128) {
        Self::require_admin(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let mut info: ResolverInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Resolver(resolver.clone()))
            .unwrap_or_else(|| panic_with_error!(&env, Error::ResolverNotFound));
        let take = amount.min(info.stake);
        let asset: Address = env.storage().instance().get(&DataKey::StakeAsset).unwrap();
        let beneficiary: Address = env
            .storage()
            .instance()
            .get(&DataKey::SlashBeneficiary)
            .unwrap();
        token::Client::new(&env, &asset).transfer(
            &env.current_contract_address(),
            &beneficiary,
            &take,
        );
        info.stake -= take;
        info.total_slashed = info
            .total_slashed
            .checked_add(take)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        info.last_slash_at = env.ledger().timestamp();
        let min_stake: i128 = env.storage().instance().get(&DataKey::MinStake).unwrap_or(0);
        if info.stake < min_stake {
            info.active = false;
        }
        env.storage()
            .persistent()
            .set(&DataKey::Resolver(resolver.clone()), &info);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Resolver(resolver.clone()), RESOLVER_TTL_THRESHOLD, RESOLVER_TTL_TARGET);
        env.events()
            .publish((topic_slashed(), resolver), (take,));
    }

    pub fn is_active(env: Env, resolver: Address) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, ResolverInfo>(&DataKey::Resolver(resolver))
            .map(|info| info.active)
            .unwrap_or(false)
    }

    pub fn get(env: Env, resolver: Address) -> Option<ResolverInfo> {
        env.storage()
            .persistent()
            .get(&DataKey::Resolver(resolver))
    }

    pub fn list(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::ResolverList)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn min_stake(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::MinStake).unwrap_or(0)
    }

    pub fn set_min_stake(env: Env, new_minimum: i128) {
        Self::require_admin(&env);
        if new_minimum < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        env.storage().instance().set(&DataKey::MinStake, &new_minimum);
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn set_slash_beneficiary(env: Env, new_beneficiary: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::SlashBeneficiary, &new_beneficiary);
    }

    fn require_initialised(env: &Env) {
        if !env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(env, Error::NotInitialised);
        }
    }

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialised));
        admin.require_auth();
    }
}
