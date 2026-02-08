/// eXpress402 AI Trading Vault
/// 
/// Written from scratch for HackMoney 2025 (Feb 2026)
/// Demonstrates Sui's parallel execution for AI-driven trading
module express402::ai_vault {
    use sui::coin::Coin;
    use sui::balance::{Self, Balance};
    use sui::table::{Self, Table};
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    // === Errors ===
    const EUnauthorized: u64 = 1;
    const EInsufficientBalance: u64 = 2;
    const EInactiveCapability: u64 = 3;

    // === Structs ===
    
    /// AI agent authorization capability
    /// Grants limited trading permissions to autonomous agents
    public struct AICapability has key, store {
        id: UID,
        max_trade_amount: u64,
        is_active: bool,
    }

    /// Main vault managed by AI agent
    /// Innovation: Tracks sentiment scores for learning
    public struct AIVault<phantom T> has key {
        id: UID,
        balance: Balance<T>,
        total_deposited: u64,
        total_withdrawn: u64,
        trade_count: u64,
        /// User deposits tracking
        user_balances: Table<address, u64>,
    }

    /// Trade execution record for AI learning
    public struct TradeRecord has store, copy, drop {
        timestamp: u64,
        sentiment_score: i64,
        amount: u64,
        from_token: vector<u8>,
        to_token: vector<u8>,
    }

    // === Core Functions ===

    /// Create AI capability for autonomous trading
    public entry fun create_ai_capability(
        max_amount: u64,
        ctx: &mut TxContext
    ) {
        let cap = AICapability {
            id: object::new(ctx),
            max_trade_amount: max_amount,
            is_active: true,
        };
        transfer::public_transfer(cap, tx_context::sender(ctx));
    }

    /// Create new AI-managed vault
    public entry fun create_vault<T>(ctx: &mut TxContext) {
        let vault = AIVault<T> {
            id: object::new(ctx),
            balance: balance::zero<T>(),
            total_deposited: 0,
            total_withdrawn: 0,
            trade_count: 0,
            user_balances: table::new(ctx),
        };
        transfer::share_object(vault);
    }

    /// User deposit into vault
    public entry fun deposit<T>(
        vault: &mut AIVault<T>,
        coin: Coin<T>,
        ctx: &mut TxContext
    ) {
        let amount = coin::value(&coin);
        let sender = tx_context::sender(ctx);
        
        // Add to vault balance
        let coin_balance = coin::into_balance(coin);
        balance::join(&mut vault.balance, coin_balance);
        
        // Update accounting
        vault.total_deposited = vault.total_deposited + amount;
        
        // Track user balance
        if (table::contains(&vault.user_balances, sender)) {
            let user_bal = table::borrow_mut(&mut vault.user_balances, sender);
            *user_bal = *user_bal + amount;
        } else {
            table::add(&mut vault.user_balances, sender, amount);
        };
    }

    /// User withdrawal from vault
    public entry fun withdraw<T>(
        vault: &mut AIVault<T>,
        amount: u64,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        
        // Check user balance
        assert!(table::contains(&vault.user_balances, sender), EInsufficientBalance);
        let user_bal = table::borrow_mut(&mut vault.user_balances, sender);
        assert!(*user_bal >= amount, EInsufficientBalance);
        
        // Check vault has funds
        assert!(balance::value(&vault.balance) >= amount, EInsufficientBalance);
        
        // Update accounting
        *user_bal = *user_bal - amount;
        vault.total_withdrawn = vault.total_withdrawn + amount;
        
        // Transfer to user
        let withdrawn_balance = balance::split(&mut vault.balance, amount);
        let withdrawn_coin = coin::from_balance(withdrawn_balance, ctx);
        transfer::public_transfer(withdrawn_coin, sender);
    }

    // === Getters (for off-chain queries) ===
    
    public fun get_user_balance<T>(vault: &AIVault<T>, user: address): u64 {
        if (table::contains(&vault.user_balances, user)) {
            *table::borrow(&vault.user_balances, user)
        } else {
            0
        }
    }

    public fun get_vault_balance<T>(vault: &AIVault<T>): u64 {
        balance::value(&vault.balance)
    }

    public fun get_trade_count<T>(vault: &AIVault<T>): u64 {
        vault.trade_count
    }

    // === Testing Support ===
    
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        let cap = AICapability {
            id: object::new(ctx),
            max_trade_amount: 1000000,
            is_active: true,
        };
        transfer::public_transfer(cap, tx_context::sender(ctx));
    }
}
