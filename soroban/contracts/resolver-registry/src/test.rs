#![cfg(test)]

use crate::{DataKey, Error, ResolverRegistry, ResolverRegistryClient, RESOLVER_TTL_TARGET, RESOLVER_TTL_THRESHOLD};
use soroban_sdk::{
    testutils::{storage::Persistent as _, Address as _, LedgerInfo, Ledger},
    token::StellarAssetClient,
    Address, Env,
};

fn deploy_token<'a>(env: &Env, admin: &Address) -> (Address, StellarAssetClient<'a>) {
    let contract = env.register_stellar_asset_contract_v2(admin.clone());
    let address = contract.address();
    (address.clone(), StellarAssetClient::new(env, &address))
}

fn setup<'a>(env: &'a Env, stake_asset: &Address) -> (Address, ResolverRegistryClient<'a>, i128) {
    let admin = Address::generate(env);
    let slash_beneficiary = Address::generate(env);
    let min_stake: i128 = 100_0000000;
    let contract_id = env.register(ResolverRegistry, ());
    let client = ResolverRegistryClient::new(env, &contract_id);
    env.mock_all_auths();
    client.initialize(&admin, stake_asset, &min_stake, &slash_beneficiary);
    (contract_id, client, min_stake)
}

/// Advance both the wall-clock timestamp AND the ledger sequence number so
/// TTL-bump tests can drop an entry's TTL below RESOLVER_TTL_THRESHOLD in a
/// single step without thousands of individual ledger advances.
fn advance_ledger_full(env: &Env, extra_seconds: u64, extra_ledgers: u32) {
    let current = env.ledger().get();
    env.ledger().set(LedgerInfo {
        timestamp: current.timestamp + extra_seconds,
        sequence_number: current.sequence_number + extra_ledgers,
        protocol_version: current.protocol_version,
        network_id: current.network_id,
        base_reserve: current.base_reserve,
        min_temp_entry_ttl: current.min_temp_entry_ttl,
        min_persistent_entry_ttl: current.min_persistent_entry_ttl,
        max_entry_ttl: current.max_entry_ttl,
    });
}

fn get_resolver_ttl(env: &Env, contract_id: &Address, resolver: &Address) -> u32 {
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .get_ttl(&DataKey::Resolver(resolver.clone()))
    })
}

// -----------------------------------------------------------------
// Basic functional coverage
// -----------------------------------------------------------------

#[test]
fn happy_path_register_and_unregister() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac) = deploy_token(&env, &asset_admin);
    let (_, registry, min_stake) = setup(&env, &asset);

    let resolver = Address::generate(&env);
    sac.mint(&resolver, &(min_stake * 2));

    registry.register(&resolver, &min_stake);
    assert!(registry.is_active(&resolver));

    registry.unregister(&resolver);
    assert!(!registry.is_active(&resolver));
}

#[test]
fn increase_stake_updates_info() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac) = deploy_token(&env, &asset_admin);
    let (_, registry, min_stake) = setup(&env, &asset);

    let resolver = Address::generate(&env);
    sac.mint(&resolver, &(min_stake * 3));
    registry.register(&resolver, &min_stake);

    registry.increase_stake(&resolver, &min_stake);
    let info = registry.get(&resolver).unwrap();
    assert_eq!(info.stake, min_stake * 2);
}

#[test]
fn slash_below_minimum_deactivates_resolver() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac) = deploy_token(&env, &asset_admin);
    let (_, registry, min_stake) = setup(&env, &asset);

    let resolver = Address::generate(&env);
    sac.mint(&resolver, &(min_stake + 100_0000000));
    registry.register(&resolver, &min_stake);
    assert!(registry.is_active(&resolver));

    registry.slash(&resolver, &min_stake);
    assert!(!registry.is_active(&resolver));
}

#[test]
fn double_register_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac) = deploy_token(&env, &asset_admin);
    let (_, registry, min_stake) = setup(&env, &asset);

    let resolver = Address::generate(&env);
    sac.mint(&resolver, &(min_stake * 3));
    registry.register(&resolver, &min_stake);

    let res = registry.try_register(&resolver, &min_stake);
    assert_eq!(res.err().unwrap().unwrap(), Error::AlreadyRegistered.into());
}

#[test]
fn stake_below_minimum_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac) = deploy_token(&env, &asset_admin);
    let (_, registry, min_stake) = setup(&env, &asset);

    let resolver = Address::generate(&env);
    sac.mint(&resolver, &min_stake);

    let res = registry.try_register(&resolver, &(min_stake - 1));
    assert_eq!(res.err().unwrap().unwrap(), Error::StakeBelowMinimum.into());
}

// -----------------------------------------------------------------
// Storage TTL tests
// -----------------------------------------------------------------

#[test]
fn resolver_ttl_set_on_register() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac) = deploy_token(&env, &asset_admin);
    let (contract_id, registry, min_stake) = setup(&env, &asset);

    let resolver = Address::generate(&env);
    sac.mint(&resolver, &(min_stake * 2));
    registry.register(&resolver, &min_stake);

    let ttl = get_resolver_ttl(&env, &contract_id, &resolver);
    assert!(
        ttl >= RESOLVER_TTL_TARGET,
        "register must set Resolver TTL to at least RESOLVER_TTL_TARGET, got {ttl}"
    );
}

#[test]
fn resolver_ttl_bumped_on_increase_stake() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac) = deploy_token(&env, &asset_admin);
    let (contract_id, registry, min_stake) = setup(&env, &asset);

    let resolver = Address::generate(&env);
    sac.mint(&resolver, &(min_stake * 3));
    registry.register(&resolver, &min_stake);

    // Advance enough ledgers to drop TTL below RESOLVER_TTL_THRESHOLD so the
    // bump inside increase_stake is required to keep the entry alive.
    advance_ledger_full(&env, 60, RESOLVER_TTL_THRESHOLD + 1);

    registry.increase_stake(&resolver, &min_stake);

    let ttl = get_resolver_ttl(&env, &contract_id, &resolver);
    assert!(
        ttl >= RESOLVER_TTL_TARGET,
        "increase_stake must bump Resolver TTL to at least RESOLVER_TTL_TARGET, got {ttl}"
    );
}

#[test]
fn resolver_ttl_bumped_on_slash() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac) = deploy_token(&env, &asset_admin);
    let (contract_id, registry, min_stake) = setup(&env, &asset);

    let resolver = Address::generate(&env);
    // Fund with extra stake so the slash leaves the entry intact (not removed).
    sac.mint(&resolver, &(min_stake * 3));
    registry.register(&resolver, &(min_stake * 2));

    // Advance enough ledgers to drop TTL below RESOLVER_TTL_THRESHOLD so the
    // bump inside slash is required to keep the entry alive.
    advance_ledger_full(&env, 60, RESOLVER_TTL_THRESHOLD + 1);

    // Partial slash — entry survives with reduced stake.
    registry.slash(&resolver, &1i128);

    let ttl = get_resolver_ttl(&env, &contract_id, &resolver);
    assert!(
        ttl >= RESOLVER_TTL_TARGET,
        "slash must bump Resolver TTL to at least RESOLVER_TTL_TARGET, got {ttl}"
    );
}

#[test]
fn resolver_entry_removed_on_unregister() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac) = deploy_token(&env, &asset_admin);
    let (contract_id, registry, min_stake) = setup(&env, &asset);

    let resolver = Address::generate(&env);
    sac.mint(&resolver, &(min_stake * 2));
    registry.register(&resolver, &min_stake);
    assert!(registry.is_active(&resolver));

    registry.unregister(&resolver);

    // Entry should be fully removed — get returns None and is_active returns false.
    assert!(registry.get(&resolver).is_none());
    assert!(!registry.is_active(&resolver));

    // Confirm the storage key is absent (no TTL to check).
    let has_entry = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .has(&DataKey::Resolver(resolver.clone()))
    });
    assert!(!has_entry, "unregister must remove the Resolver persistent entry");
}
