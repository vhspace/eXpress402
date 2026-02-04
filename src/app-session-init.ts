import { getFundingHint, getYellowConfig } from './yellow/config.js';
import { YellowRpcClient } from './yellow/rpc.js';
import {
  createAppSessionMessage,
  createECDSAMessageSigner,
} from '@erc7824/nitrolite/dist/rpc/api.js';
import { RPCProtocolVersion } from '@erc7824/nitrolite/dist/rpc/types/index.js';

const env = {
  ...getYellowConfig(),
  participants: process.env.YELLOW_APP_SESSION_PARTICIPANTS ?? '',
  allocations: process.env.YELLOW_APP_SESSION_ALLOCATIONS ?? '',
};

if (!env.agentPrivateKey) {
  console.error('YELLOW_AGENT_PRIVATE_KEY is required.');
  process.exit(1);
}

if (!env.participants) {
  console.error('YELLOW_APP_SESSION_PARTICIPANTS is required (comma-separated addresses).');
  process.exit(1);
}

if (!env.allocations) {
  console.error('YELLOW_APP_SESSION_ALLOCATIONS is required (JSON map of address to amount).');
  process.exit(1);
}

const participants = env.participants.split(',').map(p => p.trim()) as `0x${string}`[];
const allocationMap = JSON.parse(env.allocations) as Record<string, string>;

const allocations = participants.map(participant => ({
  participant,
  asset: env.assetSymbol,
  amount: allocationMap[participant] ?? '0',
}));

const weights = participants.map(() => 1);

async function main() {
  console.error(getFundingHint(env.mode));

  const yellow = new YellowRpcClient({
    url: env.clearnodeUrl,
    privateKey: env.agentPrivateKey,
    debug: env.debug,
  });

  const signer = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
  const message = await createAppSessionMessage(signer, {
    definition: {
      application: 'mcp-shared-budget',
      protocol: RPCProtocolVersion.NitroRPC_0_4,
      participants,
      weights,
      quorum: participants.length,
      challenge: 0,
      nonce: Date.now(),
    },
    allocations,
  });

  const response = await yellow.sendRawMessage(message);
  console.error('App session response:');
  console.error(JSON.stringify(response, null, 2));
}

main().catch(error => {
  console.error('App session init failed:', error);
  process.exit(1);
});
