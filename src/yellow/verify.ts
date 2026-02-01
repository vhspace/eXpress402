import { YellowRpcClient } from "./rpc.js";
import { YellowReceipt } from "../x402/payment.js";

type LedgerTransaction = {
  id?: number;
  transaction_id?: number;
  sender?: string;
  receiver?: string;
  from_account?: string;
  to_account?: string;
  asset?: string;
  amount?: string;
  type?: string;
};

export async function verifyYellowTransfer(
  client: YellowRpcClient,
  receipt: YellowReceipt,
  merchantAddress: string,
  assetSymbol: string
): Promise<boolean> {
  const transactions = await client.request<LedgerTransaction[]>("get_ledger_transactions", {
    account_id: merchantAddress,
    asset: assetSymbol,
    limit: 25,
    sort: "desc"
  });

  const list = Array.isArray(transactions)
    ? transactions
    : (transactions as { ledgerTransactions?: LedgerTransaction[]; ledger_transactions?: LedgerTransaction[] })
        .ledgerTransactions ??
      (transactions as { ledger_transactions?: LedgerTransaction[] }).ledger_transactions ??
      [];

  const transferId = Number(receipt.transferId);
  const receiptAmount = Number(receipt.amount);
  return list.some((tx) => {
    const txId = Number(tx.id ?? tx.transaction_id ?? -1);
    const sender = String(tx.sender ?? tx.from_account ?? "");
    const receiver = String(tx.receiver ?? tx.to_account ?? "");
    const amount = Number(tx.amount ?? 0);
    return (
      txId === transferId &&
      sender.toLowerCase() === receipt.payer.toLowerCase() &&
      receiver.toLowerCase() === merchantAddress.toLowerCase() &&
      tx.asset === assetSymbol &&
      amount >= receiptAmount
    );
  });
}
