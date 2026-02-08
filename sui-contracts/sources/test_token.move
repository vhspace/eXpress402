/// eXpress402 Test Token
/// Simple faucet for testing AI vault functionality
module express402::test_token {
    use sui::coin::{Self, TreasuryCap};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    public struct TEST_TOKEN has drop {}

    const FAUCET_AMOUNT: u64 = 1000000000; // 1000 tokens (6 decimals)

    fun init(witness: TEST_TOKEN, ctx: &mut TxContext) {
        let (treasury, metadata) = coin::create_currency(
            witness,
            6,
            b"EXPR",
            b"eXpress402 Test Token",
            b"Test token for AI trading vault demo",
            option::none(),
            ctx
        );

        transfer::public_freeze_object(metadata);
        transfer::public_transfer(treasury, tx_context::sender(ctx));
    }

    /// Mint tokens for testing
    public entry fun mint(
        treasury: &mut TreasuryCap<TEST_TOKEN>,
        amount: u64,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let coins = coin::mint(treasury, amount, ctx);
        transfer::public_transfer(coins, recipient);
    }

    /// Request faucet tokens
    public entry fun request_faucet(
        treasury: &mut TreasuryCap<TEST_TOKEN>,
        ctx: &mut TxContext
    ) {
        let coins = coin::mint(treasury, FAUCET_AMOUNT, ctx);
        transfer::public_transfer(coins, tx_context::sender(ctx));
    }
}
