/**
 * Suifi - Yellow Session Management
 *
 * Manages Yellow Network payment sessions for Suifi API access
 */

import type { YellowRpcClient, LedgerBalance } from '../../yellow/rpc.js';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createAppSessionMessage,
  createCloseAppSessionMessage,
  createECDSAMessageSigner,
} from '@erc7824/nitrolite/dist/rpc/api.js';
import { RPCProtocolVersion } from '@erc7824/nitrolite/dist/rpc/types/index.js';
import type { SuifiConfig } from '../config.js';
import { YELLOW_APPLICATION } from '../config.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SessionInfo {
  sessionId: string;
  agentAddress: `0x${string}`;
  merchantAddress: `0x${string}`;
  assetSymbol: string;
  initialAmount: number;
  remainingAmount: number;
  callsUsed: number;
  callsRemaining: number;
  createdAt: Date;
  expiresAt: Date;
}

export interface SessionUsage {
  sessionId: string;
  callsUsed: number;
  callsRemaining: number;
  isExpired: boolean;
  isExhausted: boolean;
}

// ============================================================================
// SESSION MANAGER
// ============================================================================

export class YellowSessionManager {
  private config: SuifiConfig;
  private yellow: YellowRpcClient;
  private agentAddress: `0x${string}`;
  private merchantAddress: `0x${string}`;
  private currentSession: SessionInfo | null = null;

  constructor(yellow: YellowRpcClient, config: SuifiConfig) {
    this.yellow = yellow;
    this.config = config;
    this.agentAddress = privateKeyToAccount(config.yellow.agentPrivateKey as `0x${string}`).address;
    this.merchantAddress = config.yellow.merchantAddress as `0x${string}`;
  }

  /**
   * Create a new payment session
   */
  async createSession(): Promise<SessionInfo> {
    console.log('🔑 Creating Yellow payment session...');

    const participants: `0x${string}`[] = [this.agentAddress, this.merchantAddress];

    const agentSigner = createECDSAMessageSigner(
      this.config.yellow.agentPrivateKey as `0x${string}`,
    );
    const merchantSigner = createECDSAMessageSigner(
      this.config.yellow.merchantPrivateKey as `0x${string}`,
    );

    const sessionAmount = this.config.pricing.sessionDepositAmount;
    const allocations = participants.map((participant, i) => ({
      participant,
      asset: this.config.yellow.assetSymbol,
      amount: i === 0 ? sessionAmount : '0.0',
    }));

    const initialAmount = Number(allocations[0]?.amount ?? 0);

    const sessionParams = {
      definition: {
        application: YELLOW_APPLICATION,
        protocol: RPCProtocolVersion.NitroRPC_0_4,
        participants,
        weights: participants.map(() => 1),
        quorum: 2, // Both agent and merchant must sign
        challenge: 0,
        nonce: Date.now(),
      },
      allocations,
      session_data: JSON.stringify({
        ttlSeconds: 3600,
        freeCalls: this.config.pricing.freeCallsPerSession,
      }),
    };

    // Agent signs first
    const agentSessionMessage = await createAppSessionMessage(agentSigner, sessionParams);
    const sessionParsed = JSON.parse(agentSessionMessage);

    // Merchant signs the session request
    const merchantSessionSig = await merchantSigner(sessionParsed.req);
    sessionParsed.sig.push(merchantSessionSig);

    // Send to Yellow Network
    const response = (await this.yellow.sendRawMessage(JSON.stringify(sessionParsed))) as Record<
      string,
      unknown
    >;

    const sessionId =
      (response.appSessionId as string | undefined) ??
      (response.app_session_id as string | undefined) ??
      (response.appSession as { appSessionId?: string } | undefined)?.appSessionId ??
      null;

    if (!sessionId) {
      throw new Error(`Failed to create Yellow session: ${JSON.stringify(response)}`);
    }

    // Create session info
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3600 * 1000); // 1 hour

    this.currentSession = {
      sessionId,
      agentAddress: this.agentAddress,
      merchantAddress: this.merchantAddress,
      assetSymbol: this.config.yellow.assetSymbol,
      initialAmount,
      remainingAmount: initialAmount,
      callsUsed: 0,
      callsRemaining: Infinity, // Will be calculated based on balance
      createdAt: now,
      expiresAt,
    };

    console.log(`✅ Session created: ${sessionId.slice(0, 20)}...`);
    console.log(`   Initial balance: ${initialAmount} ${this.config.yellow.assetSymbol}`);
    console.log(`   Free calls: ${this.config.pricing.freeCallsPerSession}`);

    return this.currentSession;
  }

  /**
   * Get current session info
   */
  getCurrentSession(): SessionInfo | null {
    return this.currentSession;
  }

  /**
   * Check if session is valid and has remaining quota
   */
  async checkSession(): Promise<SessionUsage> {
    if (!this.currentSession) {
      return {
        sessionId: '',
        callsUsed: 0,
        callsRemaining: 0,
        isExpired: true,
        isExhausted: true,
      };
    }

    const now = Date.now();
    const isExpired = now > this.currentSession.expiresAt.getTime();

    // Get current balance from Yellow
    const remainingAmount = await this.getSessionBalance();
    const isExhausted = remainingAmount <= 0;

    // Update session
    this.currentSession.remainingAmount = remainingAmount;

    // Calculate calls used (initial - remaining) / price per call
    const pricePerCall = Number(this.config.pricing.pricePerCall);
    const amountUsed = this.currentSession.initialAmount - remainingAmount;
    const callsUsed = Math.floor(amountUsed / pricePerCall);

    this.currentSession.callsUsed = callsUsed;

    return {
      sessionId: this.currentSession.sessionId,
      callsUsed,
      callsRemaining: isExhausted ? 0 : Math.floor(remainingAmount / pricePerCall),
      isExpired,
      isExhausted,
    };
  }

  /**
   * Consume one call from the session quota
   */
  async consumeCall(): Promise<boolean> {
    const usage = await this.checkSession();

    if (usage.isExpired) {
      console.log('⚠️ Session expired');
      return false;
    }

    if (usage.isExhausted) {
      console.log('⚠️ Session exhausted - please create a new session');
      return false;
    }

    // Free calls allowance
    const freeCalls = this.config.pricing.freeCallsPerSession;
    if (usage.callsUsed < freeCalls) {
      console.log(`✅ Free call (${usage.callsUsed + 1}/${freeCalls})`);
      return true;
    }

    // Paid call - balance will be checked on next Yellow MCP call
    console.log(
      `✅ Paid call (${usage.callsUsed + 1} - balance: ${this.currentSession?.remainingAmount.toFixed(2)})`,
    );
    return true;
  }

  /**
   * Close current session and return funds
   */
  async closeSession(): Promise<void> {
    if (!this.currentSession) {
      console.log('⚠️ No active session to close');
      return;
    }

    console.log('🔒 Closing Yellow session...');

    const agentSigner = createECDSAMessageSigner(
      this.config.yellow.agentPrivateKey as `0x${string}`,
    );
    const merchantSigner = createECDSAMessageSigner(
      this.config.yellow.merchantPrivateKey as `0x${string}`,
    );

    // Get current balances before closing
    const remainingAmount = await this.getSessionBalance();

    // Get agent and merchant addresses
    const agentAccount = privateKeyToAccount(this.config.yellow.agentPrivateKey as `0x${string}`);
    const merchantAccount = privateKeyToAccount(
      this.config.yellow.merchantPrivateKey as `0x${string}`,
    );

    // Close session with proper allocations (return remaining to agent)
    const closeParams = {
      appSessionId: this.currentSession.sessionId,
      allocations: [
        {
          asset: this.config.yellow.assetSymbol,
          amount: remainingAmount.toString(),
          participant: agentAccount.address,
        },
      ],
    };

    const agentCloseMessage = await createCloseAppSessionMessage(agentSigner, {
      app_session_id: closeParams.appSessionId as `0x${string}`,
      allocations: closeParams.allocations.map(a => ({
        asset: a.asset,
        amount: a.amount,
        participant: a.participant,
      })),
    });
    const closeParsed = JSON.parse(agentCloseMessage);

    // Merchant signs
    const merchantCloseSig = await merchantSigner(closeParsed.req);
    closeParsed.sig.push(merchantCloseSig);

    // Send to Yellow
    const response = await this.yellow.sendRawMessage(JSON.stringify(closeParsed));

    console.log('✅ Session closed');
    console.log(`   Final balance: ${remainingAmount} ${this.config.yellow.assetSymbol}`);

    this.currentSession = null;
  }

  /**
   * Get session balance from Yellow
   */
  private async getSessionBalance(): Promise<number> {
    if (!this.currentSession) {
      return 0;
    }

    try {
      const balances = await this.yellow.getLedgerBalances(this.currentSession.sessionId);

      const match = balances.find(entry => entry.asset === this.config.yellow.assetSymbol);

      const amount = match ? Number(match.amount) : 0;
      return Number.isFinite(amount) ? amount : 0;
    } catch (error) {
      console.error('Error getting session balance:', error);
      return 0;
    }
  }

  /**
   * Get session info for display
   */
  getSessionDisplay(): string {
    if (!this.currentSession) {
      return 'No active session';
    }

    const { sessionId, initialAmount, remainingAmount, createdAt, expiresAt } = this.currentSession;

    const used = initialAmount - remainingAmount;
    const usagePercent = (used / initialAmount) * 100;

    return `
Session: ${sessionId.slice(0, 20)}...
Balance: ${remainingAmount.toFixed(2)} / ${initialAmount} ${this.config.yellow.assetSymbol}
Used: ${used.toFixed(2)} (${usagePercent.toFixed(1)}%)
Created: ${createdAt.toLocaleString()}
Expires: ${expiresAt.toLocaleString()}
    `.trim();
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createSessionManager(
  yellow: YellowRpcClient,
  config: SuifiConfig,
): YellowSessionManager {
  return new YellowSessionManager(yellow, config);
}
