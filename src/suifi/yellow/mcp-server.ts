/**
 * Suifi - MCP Server with Yellow Payment Integration
 *
 * MCP server that requires Yellow Network payment session
 * for accessing yield data and decision making
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { YellowRpcClient } from '../../yellow/rpc.js';
import type { SuifiConfig } from '../config.js';
import { getTopVaultsByScore, formatNumber, formatApy, formatUsd } from '../providers/defillama.js';
import { SuiVaultStrategy } from '../strategy.js';
import { SuiDecisionTracker } from '../tracker.js';
import type { VaultScore, SuiVaultDecision } from '../types.js';
import { YellowSessionManager } from './session.js';

// ============================================================================
// MCP SERVER
// ============================================================================

export class SuifiMCPServer {
  private server: Server;
  private yellow: YellowRpcClient;
  private config: SuifiConfig;
  private sessionManager: YellowSessionManager;
  private strategy: SuiVaultStrategy;
  private tracker: SuiDecisionTracker;

  constructor(
    yellow: YellowRpcClient,
    config: SuifiConfig,
    tracker?: SuiDecisionTracker
  ) {
    this.yellow = yellow;
    this.config = config;
    this.sessionManager = new YellowSessionManager(yellow, config);
    this.strategy = new SuiVaultStrategy(config.strategy);
    this.tracker = tracker || new SuiDecisionTracker(config.tracker);

    // Initialize MCP server
    this.server = new Server(
      {
        name: 'suifi-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupTools();
  }

  /**
   * Setup MCP tools
   */
  private setupTools(): void {
    // Tool: Check session status
    this.server.tool(
      'check_session',
      {
        description: 'Check Yellow payment session status and remaining quota',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        const session = this.sessionManager.getCurrentSession();
        const usage = await this.sessionManager.checkSession();

        if (!session) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    hasSession: false,
                    message: 'No active session. Please create a session first.',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  hasSession: true,
                  sessionId: session.sessionId,
                  callsUsed: usage.callsUsed,
                  callsRemaining: usage.callsRemaining,
                  isExpired: usage.isExpired,
                  isExhausted: usage.isExhausted,
                  remainingBalance: session.remainingAmount,
                  expiresAt: session.expiresAt,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // Tool: Create payment session
    this.server.tool(
      'create_session',
      {
        description: 'Create a new Yellow payment session for Suifi API access',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        try {
          const session = await this.sessionManager.createSession();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    sessionId: session.sessionId,
                    agentAddress: session.agentAddress,
                    merchantAddress: session.merchantAddress,
                    initialAmount: session.initialAmount,
                    assetSymbol: session.assetSymbol,
                    expiresAt: session.expiresAt,
                    message: `Session created with ${session.initialAmount} ${session.assetSymbol}`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }
    );

    // Tool: Get top vaults (requires valid session)
    this.server.tool(
      'get_top_vaults',
      {
        description: 'Get top Sui vaults by score (requires payment session)',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Number of vaults to return (default: 20)',
              default: 20,
            },
            minTvl: {
              type: 'number',
              description: 'Minimum TVL in USD (default: 100000)',
              default: 100000,
            },
          },
        },
      },
      async ({ limit, minTvl }) => {
        // Check session
        const allowed = await this.sessionManager.consumeCall();
        if (!allowed) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    error: 'Payment required. Please create a session first.',
                    tool: 'create_session',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Fetch vaults
        const vaults = await getTopVaultsByScore(
          limit || 20,
          { minTvlUsd: minTvl || 100000 }
        );

        const formatted = vaults.map((v) => ({
          rank: v.rank,
          project: v.vault.project,
          pool: v.pool,
          symbol: v.vault.symbol,
          apy: v.vault.apy,
          tvlUsd: v.vault.tvlUsd,
          score: v.score,
          confidence: v.confidence,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  count: formatted.length,
                  vaults: formatted,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // Tool: Get vault decision (requires valid session)
    this.server.tool(
      'get_vault_decision',
      {
        description: 'Get AI vault decision (deposit/withdraw/hold) based on current yields (requires payment session)',
        inputSchema: {
          type: 'object',
          properties: {
            record: {
              type: 'boolean',
              description: 'Whether to record the decision (default: true)',
              default: true,
            },
          },
        },
      },
      async ({ record }) => {
        // Check session
        const allowed = await this.sessionManager.consumeCall();
        if (!allowed) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    error: 'Payment required. Please create a session first.',
                    tool: 'create_session',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Fetch vaults and make decision
        const vaults = await getTopVaultsByScore(20, {
          minTvlUsd: this.config.strategy.minTvlUsd,
        });

        const decision = await this.strategy.makeDecision(vaults);

        if (!decision) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    decision: null,
                    message: 'No clear signal - holding',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Record decision if requested
        if (record) {
          await this.tracker.recordDecision(decision);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  decision: {
                    id: decision.id,
                    action: decision.action,
                    project: decision.project,
                    pool: decision.pool,
                    symbol: decision.symbol,
                    apy: decision.apyAtDecision,
                    tvl: decision.tvlAtDecision,
                    confidence: decision.confidence,
                    reason: decision.reason,
                    riskLevel: decision.riskLevel,
                    score: decision.score,
                  },
                  recorded: record,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // Tool: Get decision metrics
    this.server.tool(
      'get_metrics',
      {
        description: 'Get decision metrics and accuracy statistics',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        const metrics = this.tracker.getMetrics();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  metrics: {
                    totalDecisions: metrics.totalDecisions,
                    evaluatedDecisions: metrics.evaluatedDecisions,
                    pendingEvaluation: metrics.pendingEvaluation,
                    overallAccuracy: metrics.overallAccuracy,
                    bestProject: metrics.bestPerformingProject,
                    avgConfidence: metrics.avgConfidence,
                    avgApy: metrics.avgApy,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    // Tool: Close session
    this.server.tool(
      'close_session',
      {
        description: 'Close current payment session and return remaining funds',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async () => {
        try {
          await this.sessionManager.closeSession();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    message: 'Session closed successfully',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }
    );
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('✅ Suifi MCP Server running on stdio');
    console.error('📋 Available tools:');
    console.error('   - check_session: Check session status');
    console.error('   - create_session: Create payment session');
    console.error('   - get_top_vaults: Get top vaults (paid)');
    console.error('   - get_vault_decision: Get AI decision (paid)');
    console.error('   - get_metrics: Get metrics');
    console.error('   - close_session: Close session');
  }

  /**
   * Get tracker instance
   */
  getTracker(): SuiDecisionTracker {
    return this.tracker;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createSuifiMCPServer(
  yellow: YellowRpcClient,
  config: SuifiConfig,
  tracker?: SuiDecisionTracker
): SuifiMCPServer {
  return new SuifiMCPServer(yellow, config, tracker);
}
