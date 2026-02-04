/**
 * Structured logger for debugging agent workflows
 * Captures all key operations: wallet calls, MCP tools, Yellow RPC
 * 
 * Enable: VERBOSE_LOGGING=true
 */

const VERBOSE = process.env.VERBOSE_LOGGING === 'true';

type LogLevel = 'info' | 'debug' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  operation: string;
  details?: Record<string, unknown>;
}

class Logger {
  private logs: LogEntry[] = [];

  private log(level: LogLevel, category: string, operation: string, details?: Record<string, unknown>) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      operation,
      details,
    };

    this.logs.push(entry);

    if (VERBOSE) {
      const detailsStr = details ? ` ${JSON.stringify(details, null, 2)}` : '';
      console.error(`[${category}] ${operation}${detailsStr}`);
    }
  }

  // Agent SDK operations
  agentSetup(details: { wallet: string; network: string }) {
    this.log('info', 'AGENT', 'SDK Setup', details);
  }

  agentQuery(query: string, context?: Record<string, unknown>) {
    this.log('debug', 'AGENT', 'Query', { query, ...context });
  }

  // Wallet operations
  walletSign(details: { wallet: string; messageType: string; messageHash?: string }) {
    this.log('info', 'WALLET', 'Sign Message', details);
  }

  walletCreate(address: string) {
    this.log('info', 'WALLET', 'Created', { address });
  }

  // SIWx operations
  siwxChallenge(details: { domain: string; nonce: string; chainId: string }) {
    this.log('debug', 'SIWX', 'Challenge Created', details);
  }

  siwxSign(details: { wallet: string; nonce: string; signature: string }) {
    this.log('info', 'SIWX', 'Challenge Signed', {
      wallet: details.wallet,
      nonce: details.nonce,
      signatureLength: details.signature.length,
    });
  }

  siwxVerify(details: { wallet: string; valid: boolean; error?: string }) {
    this.log('info', 'SIWX', 'Signature Verified', details);
  }

  // MCP tool calls
  mcpToolCall(details: { tool: string; arguments: Record<string, unknown>; hasAuth: boolean }) {
    this.log('info', 'MCP', 'Tool Call', details);
  }

  mcpToolResult(details: { tool: string; success: boolean; dataSize?: number }) {
    this.log('info', 'MCP', 'Tool Result', details);
  }

  // Yellow Network operations
  yellowSessionCreate(details: {
    sessionId: string;
    participants: string[];
    quorum: number;
    amount: string;
  }) {
    this.log('info', 'YELLOW', 'Session Created', details);
  }

  yellowSessionClose(details: {
    sessionId: string;
    allocations: Record<string, string>;
    quorum: number;
  }) {
    this.log('info', 'YELLOW', 'Session Closed', details);
  }

  yellowTransfer(details: { from: string; to: string; amount: string; asset: string }) {
    this.log('debug', 'YELLOW', 'Transfer', details);
  }

  yellowAuth(details: { wallet: string; scope: string }) {
    this.log('debug', 'YELLOW', 'Authenticated', details);
  }

  // Session storage operations
  sessionStore(details: { wallet: string; sessionId: string; resource: string }) {
    this.log('debug', 'SESSION', 'Stored', details);
  }

  sessionLookup(details: { wallet: string; resource: string; found: boolean; sessionId?: string }) {
    this.log('debug', 'SESSION', 'Lookup', details);
  }

  // Nonce tracking
  nonceUsed(nonce: string) {
    this.log('debug', 'NONCE', 'Marked Used', { nonce });
  }

  nonceReplay(nonce: string) {
    this.log('warn', 'NONCE', 'Replay Detected', { nonce });
  }

  // Payment operations
  paymentRequired(details: { tool: string; price: string; extensions: string[] }) {
    this.log('info', 'PAYMENT', '402 Required', details);
  }

  paymentReceived(details: { wallet: string; amount: string; sessionId?: string }) {
    this.log('info', 'PAYMENT', 'Received', details);
  }

  paymentVerified(details: { valid: boolean; transferId?: string }) {
    this.log('info', 'PAYMENT', 'Verified', details);
  }

  // Errors
  error(category: string, operation: string, error: Error | string) {
    this.log('error', category, operation, {
      error: error instanceof Error ? error.message : error,
    });
  }

  // Get all logs
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  // Export logs
  exportLogs(format: 'json' | 'text' = 'json'): string {
    if (format === 'text') {
      return this.logs
        .map(
          entry =>
            `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.category}] ${entry.operation}${entry.details ? ` ${JSON.stringify(entry.details)}` : ''}`,
        )
        .join('\n');
    }
    return JSON.stringify(this.logs, null, 2);
  }

  // Clear logs
  clear() {
    this.logs = [];
  }
}

// Singleton instance
export const logger = new Logger();

// Helper to log with context
export function logOperation<T>(
  category: string,
  operation: string,
  fn: () => Promise<T>,
  details?: Record<string, unknown>,
): Promise<T> {
  if (VERBOSE) {
    console.error(`[${category}] Starting: ${operation}`);
    if (details) {
      console.error(`[${category}] Details:`, details);
    }
  }

  return fn()
    .then(result => {
      if (VERBOSE) {
        console.error(`[${category}] Completed: ${operation}`);
      }
      return result;
    })
    .catch(error => {
      console.error(`[${category}] Failed: ${operation}`, error);
      throw error;
    });
}
