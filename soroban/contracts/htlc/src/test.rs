#![cfg(test)]

use crate::{Error, HtlcContract, HtlcContractClient, Order, OrderStatus};
use oversync_resolver_registry::{ResolverRegistry, ResolverRegistryClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{StellarAssetClient, TokenClient},
    Address, Bytes, BytesN, Env,
};

fn deploy_token<'a>(env: &Env, admin: &Address) -> (Address, StellarAssetClient<'a>, TokenClient<'a>) {
    let contract = env.register_stellar_asset_contract_v2(admin.clone());
    let address = contract.address();
    (
        address.clone(),
        StellarAssetClient::new(env, &address),
        TokenClient::new(env, &address),
    )
}

fn sha256_32(env: &Env, bytes: &Bytes) -> BytesN<32> {
    BytesN::<32>::from(env.crypto().sha256(bytes))
}

fn setup(env: &Env, min_safety_deposit: i128) -> (Address, HtlcContractClient<'_>) {
    let admin = Address::generate(env);
    let contract_id = env.register(HtlcContract, ());
    let client = HtlcContractClient::new(env, &contract_id);
    env.mock_all_auths();
    client.initialize(&admin, &min_safety_deposit);
    (admin, client)
}

fn deploy_registry<'a>(
    env: &Env,
    admin: &Address,
    stake_asset: &Address,
    min_stake: i128,
    slash_beneficiary: &Address,
) -> (Address, ResolverRegistryClient<'a>) {
    let registry_id = env.register(ResolverRegistry, ());
    let registry = ResolverRegistryClient::new(env, &registry_id);
    registry.initialize(admin, stake_asset, &min_stake, slash_beneficiary);
    (registry_id, registry)
}

fn advance_ledger(env: &Env, seconds: u64) {
    let current = env.ledger().get();
    env.ledger().set(LedgerInfo {
        timestamp: current.timestamp + seconds,
        protocol_version: current.protocol_version,
        sequence_number: current.sequence_number + 1,
        network_id: current.network_id,
        base_reserve: current.base_reserve,
        min_temp_entry_ttl: current.min_temp_entry_ttl,
        min_persistent_entry_ttl: current.min_persistent_entry_ttl,
        max_entry_ttl: current.max_entry_ttl,
    });
}

#[test]
fn happy_path_create_and_claim() {
    let env = Env::default();
    env.mock_all_auths();

    let asset_admin = Address::generate(&env);
    let (asset, sac, token) = deploy_token(&env, &asset_admin);
    let (_admin, htlc) = setup(&env, 0);

    let sender = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let relayer = Address::generate(&env);

    sac.mint(&sender, &1_000_0000000); // 1000 XLM in stroops

    let preimage = Bytes::from_array(&env, &[7u8; 32]);
    let hashlock = sha256_32(&env, &preimage);

    let amount = 500_0000000i128; // 500 XLM
    let safety = 10_000_000i128; //   1 XLM

    let order_id = htlc.create_order(
        &sender,
        &beneficiary,
        &sender,
        &asset,
        &amount,
        &safety,
        &hashlock,
        &600u64,
    );
    assert_eq!(order_id, 1);

    // Sender lost amount + safety; contract holds them.
    assert_eq!(token.balance(&sender), 1_000_0000000 - amount - safety);
    assert_eq!(token.balance(&htlc.address), amount + safety);

    htlc.claim_order(&order_id, &preimage, &relayer);

    assert_eq!(token.balance(&beneficiary), amount);
    assert_eq!(token.balance(&relayer), safety);
    assert_eq!(token.balance(&htlc.address), 0);

    let order: Order = htlc.get_order(&order_id).unwrap();
    assert_eq!(order.status, OrderStatus::Claimed);
    assert_eq!(order.preimage, preimage);
}

#[test]
fn refund_after_timeout_pays_refund_address() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac, token) = deploy_token(&env, &asset_admin);
    let (_admin, htlc) = setup(&env, 0);

    let sender = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let refund_to = Address::generate(&env);
    let cleaner = Address::generate(&env);

    sac.mint(&sender, &100_0000000);

    let preimage = Bytes::from_array(&env, &[1u8; 32]);
    let hashlock = sha256_32(&env, &preimage);

    let amount = 50_0000000i128;
    let safety = 1_000_000i128;
    let order_id = htlc.create_order(
        &sender,
        &beneficiary,
        &refund_to,
        &asset,
        &amount,
        &safety,
        &hashlock,
        &600u64,
    );

    let early = htlc.try_refund_order(&order_id, &cleaner);
    assert!(early.is_err());

    advance_ledger(&env, 601);
    htlc.refund_order(&order_id, &cleaner);

    assert_eq!(token.balance(&refund_to), amount);
    assert_eq!(token.balance(&cleaner), safety);
    assert_eq!(token.balance(&htlc.address), 0);

    let order: Order = htlc.get_order(&order_id).unwrap();
    assert_eq!(order.status, OrderStatus::Refunded);
}

#[test]
fn claim_with_wrong_preimage_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac, _token) = deploy_token(&env, &asset_admin);
    let (_admin, htlc) = setup(&env, 0);

    let sender = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    sac.mint(&sender, &100_0000000);

    let real_preimage = Bytes::from_array(&env, &[9u8; 32]);
    let hashlock = sha256_32(&env, &real_preimage);
    let order_id = htlc.create_order(
        &sender,
        &beneficiary,
        &sender,
        &asset,
        &10_0000000i128,
        &0i128,
        &hashlock,
        &600u64,
    );

    let wrong = Bytes::from_array(&env, &[8u8; 32]);
    let res = htlc.try_claim_order(&order_id, &wrong, &beneficiary);
    assert_eq!(res.err().unwrap().unwrap(), Error::InvalidPreimage.into());
}

#[test]
fn claim_after_expiry_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac, _token) = deploy_token(&env, &asset_admin);
    let (_admin, htlc) = setup(&env, 0);

    let sender = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    sac.mint(&sender, &100_0000000);

    let preimage = Bytes::from_array(&env, &[2u8; 32]);
    let hashlock = sha256_32(&env, &preimage);
    let order_id = htlc.create_order(
        &sender,
        &beneficiary,
        &sender,
        &asset,
        &10_0000000i128,
        &0i128,
        &hashlock,
        &600u64,
    );

    advance_ledger(&env, 601);
    let res = htlc.try_claim_order(&order_id, &preimage, &beneficiary);
    assert_eq!(res.err().unwrap().unwrap(), Error::Expired.into());
}

#[test]
fn double_claim_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac, _token) = deploy_token(&env, &asset_admin);
    let (_admin, htlc) = setup(&env, 0);

    let sender = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    sac.mint(&sender, &100_0000000);

    let preimage = Bytes::from_array(&env, &[3u8; 32]);
    let hashlock = sha256_32(&env, &preimage);
    let order_id = htlc.create_order(
        &sender,
        &beneficiary,
        &sender,
        &asset,
        &10_0000000i128,
        &0i128,
        &hashlock,
        &600u64,
    );

    htlc.claim_order(&order_id, &preimage, &beneficiary);
    let res = htlc.try_claim_order(&order_id, &preimage, &beneficiary);
    assert_eq!(res.err().unwrap().unwrap(), Error::OrderNotClaimable.into());
}

#[test]
fn refund_after_claim_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac, _token) = deploy_token(&env, &asset_admin);
    let (_admin, htlc) = setup(&env, 0);

    let sender = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    sac.mint(&sender, &100_0000000);

    let preimage = Bytes::from_array(&env, &[4u8; 32]);
    let hashlock = sha256_32(&env, &preimage);
    let order_id = htlc.create_order(
        &sender,
        &beneficiary,
        &sender,
        &asset,
        &10_0000000i128,
        &0i128,
        &hashlock,
        &600u64,
    );

    htlc.claim_order(&order_id, &preimage, &beneficiary);
    advance_ledger(&env, 601);
    let res = htlc.try_refund_order(&order_id, &beneficiary);
    assert_eq!(res.err().unwrap().unwrap(), Error::OrderNotRefundable.into());
}

#[test]
fn timelock_outside_bounds_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac, _token) = deploy_token(&env, &asset_admin);
    let (_admin, htlc) = setup(&env, 0);

    let sender = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    sac.mint(&sender, &100_0000000);

    let preimage = Bytes::from_array(&env, &[5u8; 32]);
    let hashlock = sha256_32(&env, &preimage);

    let too_short = htlc.try_create_order(
        &sender,
        &beneficiary,
        &sender,
        &asset,
        &10_0000000i128,
        &0i128,
        &hashlock,
        &10u64,
    );
    assert_eq!(too_short.err().unwrap().unwrap(), Error::InvalidTimelock.into());

    let too_long = htlc.try_create_order(
        &sender,
        &beneficiary,
        &sender,
        &asset,
        &10_0000000i128,
        &0i128,
        &hashlock,
        &200_000u64,
    );
    assert_eq!(too_long.err().unwrap().unwrap(), Error::InvalidTimelock.into());
}

#[test]
fn safety_deposit_minimum_enforced() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac, _token) = deploy_token(&env, &asset_admin);
    let (_admin, htlc) = setup(&env, 1_000_000); // 0.1 XLM minimum

    let sender = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    sac.mint(&sender, &100_0000000);

    let preimage = Bytes::from_array(&env, &[6u8; 32]);
    let hashlock = sha256_32(&env, &preimage);

    let res = htlc.try_create_order(
        &sender,
        &beneficiary,
        &sender,
        &asset,
        &10_0000000i128,
        &500_000i128, // below the configured minimum
        &hashlock,
        &600u64,
    );
    assert_eq!(res.err().unwrap().unwrap(), Error::SafetyDepositTooSmall.into());
}

#[test]
fn admin_can_update_min_safety_deposit() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, htlc) = setup(&env, 100);
    assert_eq!(htlc.min_safety_deposit(), 100);
    htlc.set_min_safety_deposit(&500);
    assert_eq!(htlc.min_safety_deposit(), 500);
}

#[test]
fn initialise_twice_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, htlc) = setup(&env, 0);
    let again = Address::generate(&env);
    let res = htlc.try_initialize(&again, &0);
    assert_eq!(res.err().unwrap().unwrap(), Error::AlreadyInitialised.into());
}

#[test]
fn active_resolver_can_create_order_when_registry_is_set() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac, _token) = deploy_token(&env, &asset_admin);
    let (admin, htlc) = setup(&env, 0);

    let sender = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    sac.mint(&sender, &100_0000000);

    let (registry_id, registry) = deploy_registry(&env, &admin, &asset, 10_0000000, &admin);
    registry.register(&sender, &10_0000000);
    htlc.set_resolver_registry(&registry_id);

    let preimage = Bytes::from_array(&env, &[11u8; 32]);
    let hashlock = sha256_32(&env, &preimage);
    let order_id = htlc.create_order(
        &sender,
        &beneficiary,
        &sender,
        &asset,
        &20_0000000i128,
        &0i128,
        &hashlock,
        &600u64,
    );

    assert_eq!(order_id, 1);
}

#[test]
fn inactive_resolver_cannot_create_order_when_registry_is_set() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac, _token) = deploy_token(&env, &asset_admin);
    let (admin, htlc) = setup(&env, 0);

    let sender = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    sac.mint(&sender, &100_0000000);

    let (registry_id, _registry) = deploy_registry(&env, &admin, &asset, 10_0000000, &admin);
    htlc.set_resolver_registry(&registry_id);

    let preimage = Bytes::from_array(&env, &[12u8; 32]);
    let hashlock = sha256_32(&env, &preimage);
    let res = htlc.try_create_order(
        &sender,
        &beneficiary,
        &sender,
        &asset,
        &20_0000000i128,
        &0i128,
        &hashlock,
        &600u64,
    );

    assert_eq!(res.err().unwrap().unwrap(), Error::ResolverNotAuthorised.into());
}
