import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { YellowRpcClient, LedgerBalance } from '../../yellow/rpc.js';

export function getToolText(result: unknown): { text: string; isError: boolean } {
  const r = result as {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };

  const text = r.content?.find(entry => entry?.type === 'text')?.text ?? r.content?.[0]?.text ?? '';
  return { text, isError: r.isError === true };
}

export function parseJsonFromToolText<T>(toolName: string, text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
    throw new Error(`${toolName} returned non-JSON text: ${snippet || '(empty)'}`);
  }
}

export async function stopSpawnedMcpServer(transport: StdioClientTransport | null): Promise<void> {
  if (!transport) return;
  await transport.close();
}

export async function getSessionAssetBalance(params: {
  yellow: YellowRpcClient;
  sessionId: string;
  assetSymbol: string;
}): Promise<number> {
  const balances = (await params.yellow.getLedgerBalances(params.sessionId)) as LedgerBalance[];
  const match = balances.find(entry => entry.asset === params.assetSymbol);
  const amount = match ? Number(match.amount) : 0;
  return Number.isFinite(amount) ? amount : 0;
}

export function computeSessionCloseAllocations(params: {
  agentAddress: `0x${string}` | null;
  merchantAddress: `0x${string}` | null;
  assetSymbol: string;
  /** Total amount initially allocated to the agent in the session. */
  initialAmount: number;
  /** Remaining amount as reported by Yellow for the session ledger. */
  remainingAmount: number;
}): Array<{ participant: `0x${string}`; asset: string; amount: string }> {
  const agent = params.agentAddress;
  const merchant = params.merchantAddress;
  if (!agent || !merchant) return [];

  const initial = Number.isFinite(params.initialAmount) ? params.initialAmount : 0;
  const remaining = Number.isFinite(params.remainingAmount) ? params.remainingAmount : 0;

  const agentAmount = Math.max(0, Math.min(initial, remaining));
  const merchantAmount = Math.max(0, initial - agentAmount);

  return [
    { participant: agent, asset: params.assetSymbol, amount: agentAmount.toFixed(6) },
    { participant: merchant, asset: params.assetSymbol, amount: merchantAmount.toFixed(6) },
  ];
}

