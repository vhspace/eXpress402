/**
 * Sentifi Agent - LI.FI Execution Module
 * Handles cross-chain swaps and Composer workflows
 */

import { createConfig, executeRoute, getContractCallsQuote, getRoutes, getQuote } from '@lifi/sdk';
import type { Route, RoutesRequest } from '@lifi/sdk';
import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  type WalletClient,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, optimism, base, mainnet } from 'viem/chains';
import type { Action, ExecutionResult, AgentConfig } from './types.js';
import { CHAIN_EXPLORERS } from './types.js';

// Chain configurations
const CHAIN_MAP = {
  1: mainnet,
  10: optimism,
  137: {
    id: 137,
    name: 'Polygon',
    network: 'polygon',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://polygon-rpc.com'] },
      public: { http: ['https://polygon-rpc.com'] },
    },
  },
  42161: arbitrum,
  8453: base,
} as const;

const RPC_URLS: Record<number, string> = {
  1: 'https://eth.llamarpc.com',
  10: 'https://mainnet.optimism.io',
  137: 'https://polygon-rpc.com',
  42161: 'https://arb1.arbitrum.io/rpc',
  8453: 'https://mainnet.base.org',
};

// Aave V3 Pool ABI (for Composer deposits)
const AAVE_POOL_ABI = [
  {
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    name: 'supply',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// Protocol addresses by chain
const AAVE_V3_POOL: Record<number, string> = {
  42161: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', // Arbitrum
  10: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', // Optimism
  8453: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', // Base
};

let lifiInitialized = false;

/**
 * Initialize LI.FI SDK
 */
export function initLifi(integratorId: string): void {
  if (lifiInitialized) return;

  createConfig({
    integrator: integratorId,
  });

  lifiInitialized = true;
}

/**
 * Create wallet client for a chain
 */
function createWallet(
  privateKey: string,
  chainId: number,
): { wallet: WalletClient; publicClient: PublicClient; address: string } {
  const chain = CHAIN_MAP[chainId as keyof typeof CHAIN_MAP];
  if (!chain) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const rpcUrl = RPC_URLS[chainId] ?? '';

  const wallet = createWalletClient({
    account,
    chain: chain as typeof arbitrum,
    transport: http(rpcUrl),
  });

  const publicClient = createPublicClient({
    chain: chain as typeof arbitrum,
    transport: http(rpcUrl),
  });

  return { wallet, publicClient, address: account.address };
}

/**
 * Execute a simple cross-chain or same-chain swap via LI.FI
 */
async function executeSimpleSwap(action: Action, config: AgentConfig): Promise<ExecutionResult> {
  const { params } = action;

  const { address } = createWallet(config.wallet.privateKey, params.fromChain);

  console.log(
    `[EXECUTE] Getting routes for ${params.amountFormatted} ${params.fromToken} → ${params.toToken}`,
  );

  try {
    // Get routes from LI.FI (returns Route[] which can be executed)
    const routesRequest: RoutesRequest = {
      fromAddress: address,
      fromChainId: params.fromChain,
      toChainId: params.toChain,
      fromTokenAddress: params.fromTokenAddress,
      toTokenAddress: params.toTokenAddress,
      fromAmount: params.amount.toString(),
      options: {
        slippage: 0.03, // 3%
        order: 'RECOMMENDED',
      },
    };

    const routesResponse = await getRoutes(routesRequest);
    const routes = routesResponse.routes;

    if (!routes || routes.length === 0) {
      return {
        success: false,
        error: 'No routes found for this swap',
      };
    }

    const route = routes[0]; // Use the recommended route

    console.log('[EXECUTE] Route received:');
    console.log(`  Steps: ${route.steps.length}`);
    console.log(`  Estimated output: ${route.toAmountMin ?? 'N/A'}`);
    console.log(`  Gas estimate: ${route.gasCostUSD ?? 'N/A'} USD`);

    // For demo mode, we can simulate or execute
    const isDemoMode = process.env.SENTIFI_DEMO_MODE === 'true';

    if (isDemoMode) {
      console.log('[EXECUTE] Demo mode - skipping actual execution');
      return {
        success: true,
        txHash: `0x${'demo'.repeat(16)}`,
        fromAmount: params.amountFormatted,
        toAmount: route.toAmountMin ?? '0',
        route: route.steps[0]?.toolDetails?.name ?? 'LI.FI',
      };
    }

    // Execute the route
    console.log('[EXECUTE] Executing swap...');

    const result = await executeRoute(route, {
      updateRouteHook: (updatedRoute: Route) => {
        console.log(`[EXECUTE] Route update: ${updatedRoute.steps.length} steps`);
      },
    });

    // Extract tx hash from execution result
    // The executeRoute adds execution data to the route object
    const executedStep = result.steps[0] as unknown as {
      execution?: { process?: Array<{ txHash?: string }> };
    };
    const txHash = executedStep?.execution?.process?.[0]?.txHash ?? '';
    const explorerUrl = CHAIN_EXPLORERS[params.fromChain]
      ? `${CHAIN_EXPLORERS[params.fromChain]}${txHash}`
      : undefined;

    return {
      success: true,
      txHash,
      fromAmount: params.amountFormatted,
      toAmount: result.toAmountMin,
      route: route.steps[0]?.toolDetails?.name ?? 'LI.FI',
      explorerUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[EXECUTE] Swap failed: ${message}`);

    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Execute a Composer workflow (bridge → swap → deposit)
 * Uses LI.FI's contract calls feature for multi-step DeFi operations
 */
async function executeComposerDeposit(
  action: Action,
  config: AgentConfig,
): Promise<ExecutionResult> {
  const { params } = action;

  const { address } = createWallet(config.wallet.privateKey, params.fromChain);

  const poolAddress = AAVE_V3_POOL[params.toChain];
  if (!poolAddress) {
    return {
      success: false,
      error: `No Aave V3 pool configured for chain ${params.toChain}`,
    };
  }

  console.log('[COMPOSER] Preparing deposit workflow');
  console.log(`  From: ${params.amountFormatted} ${params.fromToken} on chain ${params.fromChain}`);
  console.log(`  To: Deposit into ${params.yieldProtocol ?? 'Aave'} on chain ${params.toChain}`);

  // For demo mode, simulate the workflow
  const isDemoMode = process.env.SENTIFI_DEMO_MODE === 'true';

  if (isDemoMode) {
    console.log('[COMPOSER] Demo mode - simulating workflow');
    console.log(`  Step 1: Bridge ${params.fromToken} to chain ${params.toChain}`);
    console.log('  Step 2: Swap to USDC if needed');
    console.log(`  Step 3: Deposit into ${params.yieldProtocol ?? 'Aave'} pool`);

    return {
      success: true,
      txHash: `0x${'composer_demo'.repeat(5)}`,
      fromAmount: params.amountFormatted,
      workflow: 'bridge-swap-deposit',
      toAmount: params.amountFormatted,
    };
  }

  try {
    // Encode the Aave supply call
    const supplyCallData = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: 'supply',
      args: [
        params.toTokenAddress as `0x${string}`,
        params.amount,
        address as `0x${string}`,
        0, // referral code
      ],
    });

    // Get contract calls quote from LI.FI
    const quote = await getContractCallsQuote({
      fromAddress: address,
      fromChain: params.fromChain,
      fromToken: params.fromTokenAddress,
      fromAmount: params.amount.toString(),
      toChain: params.toChain,
      toToken: params.toTokenAddress,
      contractCalls: [
        {
          fromAmount: params.amount.toString(),
          fromTokenAddress: params.toTokenAddress,
          toContractAddress: poolAddress,
          toContractCallData: supplyCallData,
          toContractGasLimit: '300000',
        },
      ],
    });

    console.log('[COMPOSER] Quote received for multi-step workflow');

    // Execute the Composer workflow
    // Note: getContractCallsQuote returns a route-compatible object
    console.log('[COMPOSER] Executing multi-step workflow...');

    const result = await executeRoute(quote as unknown as Route, {
      updateRouteHook: (updatedRoute: Route) => {
        console.log(`[COMPOSER] Route update: ${updatedRoute.steps.length} steps`);
      },
    });

    // Extract tx hash from execution result
    const executedStep = result.steps[0] as unknown as {
      execution?: { process?: Array<{ txHash?: string }> };
    };
    const txHash = executedStep?.execution?.process?.[0]?.txHash ?? '';
    const explorerUrl = CHAIN_EXPLORERS[params.fromChain]
      ? `${CHAIN_EXPLORERS[params.fromChain]}${txHash}`
      : undefined;

    return {
      success: true,
      txHash,
      fromAmount: params.amountFormatted,
      toAmount: result.toAmountMin,
      workflow: 'bridge-swap-deposit',
      explorerUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[COMPOSER] Deposit workflow failed: ${message}`);

    return {
      success: false,
      error: message,
      workflow: 'bridge-swap-deposit',
    };
  }
}

/**
 * Main execution function - routes to appropriate handler
 */
export async function execute(action: Action, config: AgentConfig): Promise<ExecutionResult> {
  // Initialize LI.FI if needed
  initLifi(config.lifi.integratorId);

  switch (action.type) {
    case 'SWAP_BULLISH':
    case 'SWAP_BEARISH':
    case 'REBALANCE':
      return executeSimpleSwap(action, config);

    case 'DEPOSIT_YIELD':
      return executeComposerDeposit(action, config);

    case 'WITHDRAW_YIELD':
      // TODO: Implement withdrawal workflow
      return {
        success: false,
        error: 'Withdrawal workflow not yet implemented',
      };

    case 'HOLD':
    default:
      return {
        success: true,
        txHash: undefined,
      };
  }
}

/**
 * Get a quote without executing (for preview)
 */
export async function getSwapQuote(
  action: Action,
  config: AgentConfig,
): Promise<{ estimatedOutput: string; gasCostUsd: string; route: string } | null> {
  initLifi(config.lifi.integratorId);

  const { params } = action;
  const { address } = createWallet(config.wallet.privateKey, params.fromChain);

  try {
    const quote = await getQuote({
      fromAddress: address,
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromToken: params.fromTokenAddress,
      toToken: params.toTokenAddress,
      fromAmount: params.amount.toString(),
      slippage: 0.03,
    });

    return {
      estimatedOutput: quote.estimate?.toAmountMin ?? '0',
      gasCostUsd: quote.estimate?.gasCosts?.[0]?.amountUSD ?? '0',
      route: quote.toolDetails?.name ?? 'Unknown',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to get quote: ${message}`);
    return null;
  }
}
