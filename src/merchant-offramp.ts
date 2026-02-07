/**
 * Merchant Offramp - Withdraw funds from Yellow Network to on-chain wallet
 *
 * This is a stub implementation. The actual offramp functionality requires
 * a custody ledger balance (from on-chain deposits), not unified balance.
 */

export interface OfframpResult {
  channelId: string;
  amount: string;
  asset: string;
  destination: string;
  transactions: Array<{ step: string; hash: string }>;
}

export async function offrampMerchantFunds(
  _merchantAddress: string | undefined,
  _network: 'sepolia' | 'base',
): Promise<OfframpResult | null> {
  console.log('Merchant offramp not available - requires custody ledger balance');
  console.log('Use `npm run merchant-spend` to transfer unified balance instead');
  return null;
}
