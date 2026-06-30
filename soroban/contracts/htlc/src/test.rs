#![cfg(test)]

use crate::{DataKey, Error, HtlcContract, HtlcContractClient, Order, OrderStatus, ORDER_TTL_TARGET, ORDER_TTL_THRESHOLD};
use oversync_resolver_registry::{ResolverRegistry, ResolverRegistryClient};
use soroban_sdk::{
    testutils::{storage::Persistent as _, Address as _, Ledger, LedgerInfo},
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

/// Advance both the wall-clock timestamp AND the ledger sequence number so
/// TTL-bump tests can drop an entry's TTL below ORDER_TTL_THRESHOLD in a
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

// ---------------------------------------------------------------------
// Resolver-registry binding (cross-contract enforcement of `is_active`)
// ---------------------------------------------------------------------

/// Deploy + initialise a ResolverRegistry next to the HTLC, using the
/// same SAC asset for stake. Returns the registry client and the
/// minimum stake value used.
fn setup_registry<'a>(
    env: &'a Env,
    stake_asset: &Address,
) -> (Address, ResolverRegistryClient<'a>, i128) {
    let registry_admin = Address::generate(env);
    let slash_beneficiary = Address::generate(env);
    let min_stake: i128 = 100_0000000; // 100 stake-asset units
    let registry_id = env.register(ResolverRegistry, ());
    let registry = ResolverRegistryClient::new(env, &registry_id);
    registry.initialize(&registry_admin, stake_asset, &min_stake, &slash_beneficiary);
    (registry_id, registry, min_stake)
}

#[test]
fn create_order_succeeds_for_active_registered_resolver() {
    let env = Env::default();
    env.mock_all_auths();

    let asset_admin = Address::generate(&env);
    let (asset, sac, token) = deploy_token(&env, &asset_admin);
    let (_admin, htlc) = setup(&env, 0);

    let (registry_id, registry, min_stake) = setup_registry(&env, &asset);
    htlc.set_resolver_registry(&registry_id);

    // Fund and register the resolver as an active staker.
    let resolver = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    sac.mint(&resolver, &(min_stake + 500_0000000));
    registry.register(&resolver, &min_stake);
    assert!(registry.is_active(&resolver));

    let preimage = Bytes::from_array(&env, &[42u8; 32]);
    let hashlock = sha256_32(&env, &preimage);

    let amount = 100_0000000i128;
    let order_id = htlc.create_order(
        &resolver,
        &beneficiary,
        &resolver,
        &asset,
        &amount,
        &0i128,
        &hashlock,
        &600u64,
    );
    assert_eq!(order_id, 1);
    assert_eq!(token.balance(&htlc.address), amount);

    // Claim path must remain permissionless even though the registry is
    // configured — the registry only gates create_order.
    let outsider = Address::generate(&env);
    htlc.claim_order(&order_id, &preimage, &outsider);
    let order: Order = htlc.get_order(&order_id).unwrap();
    assert_eq!(order.status, OrderStatus::Claimed);
}

#[test]
fn create_order_rejects_unregistered_sender_when_registry_is_set() {
    let env = Env::default();
    env.mock_all_auths();

    let asset_admin = Address::generate(&env);
    let (asset, sac, _token) = deploy_token(&env, &asset_admin);
    let (_admin, htlc) = setup(&env, 0);

    let (registry_id, _registry, _min_stake) = setup_registry(&env, &asset);
    htlc.set_resolver_registry(&registry_id);

    // `stranger` was never registered with the registry.
    let stranger = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    sac.mint(&stranger, &100_0000000);

    let preimage = Bytes::from_array(&env, &[11u8; 32]);
    let hashlock = sha256_32(&env, &preimage);

    let res = htlc.try_create_order(
        &stranger,
        &beneficiary,
        &stranger,
        &asset,
        &10_0000000i128,
        &0i128,
        &hashlock,
        &600u64,
    );
    assert_eq!(
        res.err().unwrap().unwrap(),
        Error::ResolverNotAuthorised.into()
    );
}

#[test]
fn create_order_rejects_resolver_made_inactive_by_slash() {
    // A resolver whose stake is slashed below the minimum is marked
    // inactive by the registry. The HTLC must consult the live state on
    // every create_order, not a cached snapshot.
    let env = Env::default();
    env.mock_all_auths();

    let asset_admin = Address::generate(&env);
    let (asset, sac, _token) = deploy_token(&env, &asset_admin);
    let (_admin, htlc) = setup(&env, 0);

    let (registry_id, registry, min_stake) = setup_registry(&env, &asset);
    htlc.set_resolver_registry(&registry_id);

    let resolver = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    sac.mint(&resolver, &(min_stake + 100_0000000));
    registry.register(&resolver, &min_stake);
    assert!(registry.is_active(&resolver));

    // Slash the full stake — registry drops the resolver below the
    // minimum and flips `active` to false.
    registry.slash(&resolver, &min_stake);
    assert!(!registry.is_active(&resolver));

    let preimage = Bytes::from_array(&env, &[12u8; 32]);
    let hashlock = sha256_32(&env, &preimage);
    let res = htlc.try_create_order(
        &resolver,
        &beneficiary,
        &resolver,
        &asset,
        &10_0000000i128,
        &0i128,
        &hashlock,
        &600u64,
    );
    assert_eq!(
        res.err().unwrap().unwrap(),
        Error::ResolverNotAuthorised.into()
    );
}

#[test]
fn clear_resolver_registry_restores_permissionless_create_order() {
    // After clear_resolver_registry the HTLC must accept any sender
    // again — proves the binding is dynamic, not baked in at deploy.
    let env = Env::default();
    env.mock_all_auths();

    let asset_admin = Address::generate(&env);
    let (asset, sac, _token) = deploy_token(&env, &asset_admin);
    let (_admin, htlc) = setup(&env, 0);

    let (registry_id, _registry, _min_stake) = setup_registry(&env, &asset);
    htlc.set_resolver_registry(&registry_id);

    let stranger = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    sac.mint(&stranger, &100_0000000);

    let preimage = Bytes::from_array(&env, &[13u8; 32]);
    let hashlock = sha256_32(&env, &preimage);

    // Blocked while registry is bound.
    let blocked = htlc.try_create_order(
        &stranger,
        &beneficiary,
        &stranger,
        &asset,
        &10_0000000i128,
        &0i128,
        &hashlock,
        &600u64,
    );
    assert_eq!(
        blocked.err().unwrap().unwrap(),
        Error::ResolverNotAuthorised.into()
    );

    // Admin clears the binding; the HTLC stays correct (hashlock +
    // timelock still gate funds) and create_order becomes open again.
    htlc.clear_resolver_registry();
    let order_id = htlc.create_order(
        &stranger,
        &beneficiary,
        &stranger,
        &asset,
        &10_0000000i128,
        &0i128,
        &hashlock,
        &600u64,
    );
    assert_eq!(order_id, 1);
}

// ---------------------------------------------------------------------
// Storage TTL tests
// ---------------------------------------------------------------------

/// Read the remaining TTL of Order(order_id) from within the HTLC contract's
/// storage context. Requires testutils feature (dev-dependencies only).
fn get_order_ttl(env: &Env, contract_id: &Address, order_id: u64) -> u32 {
    env.as_contract(contract_id, || {
        env.storage().persistent().get_ttl(&DataKey::Order(order_id))
    })
}

#[test]
fn order_ttl_bumped_on_create() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac, _token) = deploy_token(&env, &asset_admin);
    let (_admin, htlc) = setup(&env, 0);

    let sender = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    sac.mint(&sender, &100_0000000i128);

    let preimage = Bytes::from_array(&env, &[20u8; 32]);
    let hashlock = sha256_32(&env, &preimage);

    let order_id = htlc.create_order(
        &sender, &beneficiary, &sender, &asset,
        &10_0000000i128, &0i128, &hashlock, &600u64,
    );

    let ttl = get_order_ttl(&env, &htlc.address, order_id);
    assert!(
        ttl >= ORDER_TTL_TARGET,
        "create_order must bump Order TTL to at least ORDER_TTL_TARGET, got {ttl}"
    );
}

#[test]
fn order_ttl_bumped_on_claim() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac, _token) = deploy_token(&env, &asset_admin);
    let (_admin, htlc) = setup(&env, 0);

    let sender = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    sac.mint(&sender, &100_0000000i128);

    let preimage = Bytes::from_array(&env, &[21u8; 32]);
    let hashlock = sha256_32(&env, &preimage);

    let order_id = htlc.create_order(
        &sender, &beneficiary, &sender, &asset,
        &10_0000000i128, &0i128, &hashlock, &600u64,
    );

    // Advance enough ledgers to drop TTL below ORDER_TTL_THRESHOLD so the
    // bump inside claim_order is required to keep the entry alive.
    // Timestamp must stay below the 600-second timelock.
    advance_ledger_full(&env, 300, ORDER_TTL_THRESHOLD + 1);

    htlc.claim_order(&order_id, &preimage, &beneficiary);

    let ttl = get_order_ttl(&env, &htlc.address, order_id);
    assert!(
        ttl >= ORDER_TTL_TARGET,
        "claim_order must bump Order TTL to at least ORDER_TTL_TARGET, got {ttl}"
    );
}

#[test]
fn order_ttl_bumped_on_refund() {
    let env = Env::default();
    env.mock_all_auths();
    let asset_admin = Address::generate(&env);
    let (asset, sac, _token) = deploy_token(&env, &asset_admin);
    let (_admin, htlc) = setup(&env, 0);

    let sender = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let cleaner = Address::generate(&env);
    sac.mint(&sender, &100_0000000i128);

    let preimage = Bytes::from_array(&env, &[22u8; 32]);
    let hashlock = sha256_32(&env, &preimage);

    let order_id = htlc.create_order(
        &sender, &beneficiary, &sender, &asset,
        &10_0000000i128, &0i128, &hashlock, &600u64,
    );

    // Advance past the timelock (601 s) AND past the TTL threshold
    // (ORDER_TTL_THRESHOLD + 1 ledgers) so the bump in refund_order is
    // required to keep the entry alive.
    advance_ledger_full(&env, 601, ORDER_TTL_THRESHOLD + 1);
    htlc.refund_order(&order_id, &cleaner);

    let ttl = get_order_ttl(&env, &htlc.address, order_id);
    assert!(
        ttl >= ORDER_TTL_TARGET,
        "refund_order must bump Order TTL to at least ORDER_TTL_TARGET, got {ttl}"
    );
}
