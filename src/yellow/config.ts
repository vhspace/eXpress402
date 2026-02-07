export type YellowMode = 'development' | 'production';

const SANDBOX_CLEARNODE_URL = 'wss://clearnet-sandbox.yellow.com/ws';
const PRODUCTION_CLEARNODE_URL = 'wss://clearnet.yellow.com/ws';

function resolveMode(clearnodeUrl: string, explicitMode?: string): YellowMode {
  if (explicitMode === 'development' || explicitMode === 'production') {
    return explicitMode;
  }
  return clearnodeUrl.includes('sandbox') ? 'development' : 'production';
}

export function getYellowConfig() {
  const explicitMode = process.env.YELLOW_ENV;
  const clearnodeUrlEnv = process.env.YELLOW_CLEARNODE_URL?.trim();
  const clearnodeUrl =
    clearnodeUrlEnv && clearnodeUrlEnv.length > 0
      ? clearnodeUrlEnv
      : explicitMode === 'production'
        ? PRODUCTION_CLEARNODE_URL
        : SANDBOX_CLEARNODE_URL;
  const mode = resolveMode(clearnodeUrl, explicitMode);

  return {
    mode,
    clearnodeUrl,
    assetSymbol: process.env.YELLOW_ASSET_SYMBOL ?? (mode === 'development' ? 'ytest.usd' : 'usdc'),
    network:
      process.env.YELLOW_NETWORK ?? (mode === 'development' ? 'yellow:sandbox' : 'yellow:mainnet'),
    pricePerCall: process.env.YELLOW_PRICE_PER_CALL ?? '1.15',
    toolPrices: parseToolPrices(process.env.YELLOW_TOOL_PRICES),
    maxTimeoutSeconds: Number(process.env.YELLOW_MAX_TIMEOUT_SECONDS ?? '60'),
    merchantAddress: process.env.YELLOW_MERCHANT_ADDRESS ?? '',
    merchantPrivateKey: process.env.YELLOW_MERCHANT_PRIVATE_KEY ?? '',
    agentAddress: process.env.YELLOW_AGENT_ADDRESS,
    agentPrivateKey: process.env.YELLOW_AGENT_PRIVATE_KEY ?? '',
    sessionPrivateKey:
      process.env.YELLOW_SESSION_PRIVATE_KEY ?? process.env.YELLOW_AGENT_PRIVATE_KEY ?? '',
    authDomain: process.env.YELLOW_AUTH_DOMAIN,
    debug: process.env.YELLOW_DEBUG === 'true',
  };
}

function parseToolPrices(raw?: string) {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function getFundingHint(mode: YellowMode) {
  if (mode === 'development') {
    return 'Sandbox mode: fund Unified Balance with the Yellow faucet (ytest.usd).';
  }
  return 'Production mode: deposit chain assets into Yellow custody before resizing channels.';
}
