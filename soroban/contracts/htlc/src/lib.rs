#![no_std]
//! OverSync HTLC contract for Stellar (Soroban).
//!
//! This contract implements the Stellar side of the OverSync cross-chain
//! bridge. It mirrors the semantics of the Ethereum `HTLCEscrow` contract
//! so that a swap between Ethereum and Stellar enforces the same
//! atomicity invariants on both chains:
//!
//! - A sender locks `amount` of a Stellar asset under a `hashlock`
//!   (sha256(preimage)) and a `timelock`.
//! - Before the `timelock` the `beneficiary` can claim the locked
//!   amount by revealing the preimage.
//! - After the `timelock` anyone can call `refund_order` to return the
//!   locked amount to the original `refund_address` (typically the
//!   original sender).
//!
//! The contract never holds custodial discretion: every transfer is
//! constrained by the on-ledger hashlock + timelock. No address —
//! including the coordinator or admin — can move locked funds without
//! satisfying these conditions.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, token, vec, Address, Bytes, BytesN, Env, IntoVal, Symbol,
};

#[cfg(test)]
mod test;

/// Maximum allowed timelock duration in seconds (24 hours).
/// Mirrors the EVM contract bound and protects users from accidentally
/// locking funds for unreasonably long periods.
const MAX_TIMELOCK_SECONDS: u64 = 86_400;

/// Minimum allowed timelock duration in seconds (5 minutes).
/// Ensures there is enough time for the user to actually claim.
const MIN_TIMELOCK_SECONDS: u64 = 300;

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    /// Contract has already been initialised.
    AlreadyInitialised = 1,
    /// Contract has not been initialised yet.
    NotInitialised = 2,
    /// Caller is not the configured admin.
    Unauthorized = 3,
    /// Order does not exist.
    OrderNotFound = 4,
    /// Order is not in a claimable state.
    OrderNotClaimable = 5,
    /// Order is not in a refundable state.
    OrderNotRefundable = 6,
    /// The preimage does not hash to the order's hashlock.
    InvalidPreimage = 7,
    /// The order timelock has not yet expired.
    NotExpired = 8,
    /// The order timelock has already expired.
    Expired = 9,
    /// The supplied amount is zero.
    InvalidAmount = 10,
    /// The supplied timelock is outside the allowed bounds.
    InvalidTimelock = 11,
    /// The supplied safety deposit is below the configured minimum.
    SafetyDepositTooSmall = 12,
    /// Caller is not authorised as a resolver.
    ResolverNotAuthorised = 13,
    /// Internal arithmetic overflow.
    Overflow = 14,
}

/// Lifecycle state for a single HTLC order.
#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum OrderStatus {
    /// Funds are locked and the preimage has not yet been revealed.
    Funded = 0,
    /// Beneficiary revealed the preimage and received the funds.
    Claimed = 1,
    /// Timelock expired and the funds were returned to refund_address.
    Refunded = 2,
}

/// A single hash + time-locked order.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Order {
    pub id: u64,
    /// Account that locked the funds (and paid the safety deposit).
    pub sender: Address,
    /// Account that can claim the funds by revealing the preimage.
    pub beneficiary: Address,
    /// Account that receives the funds back after a timeout.
    pub refund_address: Address,
    /// The asset locked. Use the native XLM asset contract here for
    /// native swaps; SAC and Soroban tokens are also supported.
    pub asset: Address,
    /// Amount of `asset` locked (in the asset's smallest unit).
    pub amount: i128,
    /// Safety deposit posted by the order creator. Goes to whoever
    /// triggers the terminal state (claim or refund) as an incentive
    /// to keep the network alive.
    pub safety_deposit: i128,
    /// sha256(preimage).
    pub hashlock: BytesN<32>,
    /// Unix-second timestamp after which `refund_order` becomes valid.
    pub timelock: u64,
    /// Current lifecycle state.
    pub status: OrderStatus,
    /// Preimage revealed by claim_order (empty until claim).
    pub preimage: Bytes,
    /// Ledger timestamp at creation time.
    pub created_at: u64,
    /// Ledger timestamp at terminal state (0 while funded).
    pub finalised_at: u64,
}

/// Storage keys. Persistent storage is bumped on every write so the
/// ledger entry stays alive for the entire lifetime of the order.
#[contracttype]
#[derive(Clone)]
enum DataKey {
    /// Admin address that can update configuration (e.g. min safety deposit).
    Admin,
    /// Next order id counter.
    NextOrderId,
    /// Order data, keyed by id.
    Order(u64),
    /// Address of the ResolverRegistry contract. Optional; if unset, the
    /// HTLC accepts any resolver (the contract is still safe because all
    /// movements are gated by hashlock/timelock).
    ResolverRegistry,
    /// Minimum safety deposit (in stroops, i.e. 1e-7 XLM).
    MinSafetyDeposit,
}

/// Events emitted by the contract. Topics are short symbols so they fit
/// in the 4-symbol Soroban constraint.
fn topic_created() -> Symbol { symbol_short!("created") }
fn topic_claimed() -> Symbol { symbol_short!("claimed") }
fn topic_refunded() -> Symbol { symbol_short!("refunded") }

#[contract]
pub struct HtlcContract;

#[contractimpl]
impl HtlcContract {
    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------

    /// Initialise the contract. Must be called exactly once after deploy.
    /// `admin` can update `min_safety_deposit` and the optional
    /// `ResolverRegistry` address. The admin can NEVER move user funds.
    pub fn initialize(env: Env, admin: Address, min_safety_deposit: i128) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialised);
        }
        if min_safety_deposit < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextOrderId, &1u64);
        env.storage().instance().set(&DataKey::MinSafetyDeposit, &min_safety_deposit);
        env.storage().instance().extend_ttl(50_000, 100_000);
    }

    /// Set or update the resolver registry contract address. Pass
    /// `Option::None` semantics by calling `clear_resolver_registry`.
    pub fn set_resolver_registry(env: Env, registry: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::ResolverRegistry, &registry);
    }

    /// Remove the resolver registry binding (any address may create orders).
    pub fn clear_resolver_registry(env: Env) {
        Self::require_admin(&env);
        env.storage().instance().remove(&DataKey::ResolverRegistry);
    }

    /// Update the minimum safety deposit.
    pub fn set_min_safety_deposit(env: Env, new_minimum: i128) {
        Self::require_admin(&env);
        if new_minimum < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        env.storage().instance().set(&DataKey::MinSafetyDeposit, &new_minimum);
    }

    /// Transfer admin role to a new address.
    pub fn set_admin(env: Env, new_admin: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    // ---------------------------------------------------------------------
    // Core HTLC operations
    // ---------------------------------------------------------------------

    /// Create and fund a new HTLC order.
    ///
    /// `sender.require_auth()` is the on-ledger authorisation that
    /// the sender owns the locked funds. The function transfers
    /// `amount` of `asset` from `sender` to this contract and records
    /// the order under `hashlock`.
    pub fn create_order(
        env: Env,
        sender: Address,
        beneficiary: Address,
        refund_address: Address,
        asset: Address,
        amount: i128,
        safety_deposit: i128,
        hashlock: BytesN<32>,
        timelock_seconds: u64,
    ) -> u64 {
        Self::require_initialised(&env);
        sender.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if safety_deposit < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if !(MIN_TIMELOCK_SECONDS..=MAX_TIMELOCK_SECONDS).contains(&timelock_seconds) {
            panic_with_error!(&env, Error::InvalidTimelock);
        }

        let min_sd: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MinSafetyDeposit)
            .unwrap_or(0);
        if safety_deposit < min_sd {
            panic_with_error!(&env, Error::SafetyDepositTooSmall);
        }

        // If a resolver registry is configured, require the sender to be
        // an active resolver. The registry contract owns the membership
        // policy (stake, slash, activation). The HTLC remains correct
        // even without this check — funds are still gated by hashlock +
        // timelock — but enforcing it here keeps the off-chain order
        // book sybil-resistant. Claim and refund stay permissionless
        // regardless of registry state.
        if let Some(registry) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::ResolverRegistry)
        {
            let active: bool = env.invoke_contract(
                &registry,
                &Symbol::new(&env, "is_active"),
                vec![&env, sender.into_val(&env)],
            );
            if !active {
                panic_with_error!(&env, Error::ResolverNotAuthorised);
            }
        }

        let now = env.ledger().timestamp();
        let timelock = now
            .checked_add(timelock_seconds)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));

        let order_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextOrderId)
            .unwrap_or(1);
        env.storage()
            .instance()
            .set(&DataKey::NextOrderId, &(order_id + 1));

        // Pull the locked amount + safety deposit from sender to the
        // contract address. token::Client honours sender.require_auth().
        let token_client = token::Client::new(&env, &asset);
        let total = amount
            .checked_add(safety_deposit)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        token_client.transfer(&sender, &env.current_contract_address(), &total);

        let order = Order {
            id: order_id,
            sender: sender.clone(),
            beneficiary: beneficiary.clone(),
            refund_address: refund_address.clone(),
            asset: asset.clone(),
            amount,
            safety_deposit,
            hashlock: hashlock.clone(),
            timelock,
            status: OrderStatus::Funded,
            preimage: Bytes::new(&env),
            created_at: now,
            finalised_at: 0,
        };

        env.storage().persistent().set(&DataKey::Order(order_id), &order);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Order(order_id), 50_000, 100_000);

        env.events().publish(
            (topic_created(), sender, beneficiary, hashlock),
            (order_id, asset, amount, safety_deposit, timelock),
        );

        order_id
    }

    /// Reveal the preimage and transfer the locked amount to
    /// `beneficiary`. The safety deposit is paid to the caller (which
    /// is typically the beneficiary, but can be any address — this
    /// incentivises permissionless secret-reveal relays).
    pub fn claim_order(env: Env, order_id: u64, preimage: Bytes, caller: Address) {
        Self::require_initialised(&env);
        caller.require_auth();

        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::OrderNotFound));

        if order.status != OrderStatus::Funded {
            panic_with_error!(&env, Error::OrderNotClaimable);
        }
        if env.ledger().timestamp() > order.timelock {
            panic_with_error!(&env, Error::Expired);
        }

        // Hashlock check: sha256(preimage) MUST equal the stored hash.
        let computed = env.crypto().sha256(&preimage);
        if BytesN::<32>::from(computed) != order.hashlock {
            panic_with_error!(&env, Error::InvalidPreimage);
        }

        let token_client = token::Client::new(&env, &order.asset);
        // Locked amount goes to beneficiary.
        token_client.transfer(
            &env.current_contract_address(),
            &order.beneficiary,
            &order.amount,
        );
        // Safety deposit goes to whoever submitted the claim tx.
        if order.safety_deposit > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &caller,
                &order.safety_deposit,
            );
        }

        order.status = OrderStatus::Claimed;
        order.preimage = preimage.clone();
        order.finalised_at = env.ledger().timestamp();
        env.storage().persistent().set(&DataKey::Order(order_id), &order);

        env.events().publish(
            (topic_claimed(), order.beneficiary.clone(), order.hashlock.clone()),
            (order_id, caller, preimage, order.amount, order.safety_deposit),
        );
    }

    /// Permissionless refund after the timelock has expired. The locked
    /// amount goes back to `refund_address`; the safety deposit is paid
    /// to the caller (incentivising anyone to clean up expired orders).
    pub fn refund_order(env: Env, order_id: u64, caller: Address) {
        Self::require_initialised(&env);
        caller.require_auth();

        let mut order: Order = env
            .storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::OrderNotFound));

        if order.status != OrderStatus::Funded {
            panic_with_error!(&env, Error::OrderNotRefundable);
        }
        if env.ledger().timestamp() <= order.timelock {
            panic_with_error!(&env, Error::NotExpired);
        }

        let token_client = token::Client::new(&env, &order.asset);
        token_client.transfer(
            &env.current_contract_address(),
            &order.refund_address,
            &order.amount,
        );
        if order.safety_deposit > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &caller,
                &order.safety_deposit,
            );
        }

        order.status = OrderStatus::Refunded;
        order.finalised_at = env.ledger().timestamp();
        env.storage().persistent().set(&DataKey::Order(order_id), &order);

        env.events().publish(
            (topic_refunded(), order.refund_address.clone(), order.hashlock.clone()),
            (order_id, caller, order.amount, order.safety_deposit),
        );
    }

    // ---------------------------------------------------------------------
    // Read-only helpers
    // ---------------------------------------------------------------------

    pub fn get_order(env: Env, order_id: u64) -> Option<Order> {
        env.storage().persistent().get(&DataKey::Order(order_id))
    }

    pub fn next_order_id(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextOrderId)
            .unwrap_or(1)
    }

    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialised))
    }

    pub fn min_safety_deposit(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MinSafetyDeposit)
            .unwrap_or(0)
    }

    pub fn resolver_registry(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::ResolverRegistry)
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

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
