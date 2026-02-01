import WebSocket from 'ws';
import { signPayload } from './codec.js';
import {
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
  createCloseAppSessionMessage,
  createECDSAMessageSigner,
  createEIP712AuthMessageSigner,
  createGetAppSessionsMessageV2,
  createGetLedgerBalancesMessage,
  createTransferMessage,
} from '@erc7824/nitrolite/dist/rpc/api.js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, custom } from 'viem';

export type NitroRpcResponse<T = unknown> = {
  res: [number, string, T, number];
  sig: string[];
};

export type NitroRpcRequest = {
  req: [number, string, Record<string, unknown>, number];
  sig: string[];
};

export type NitroRpcOptions = {
  url: string;
  privateKey?: string;
  timeoutMs?: number;
  authDomain?: string;
  debug?: boolean;
};

export type AuthOptions = {
  application?: string;
  scope?: string;
  allowances?: Array<{ asset: string; amount: string }>;
  expiresInMs?: number;
  sessionPrivateKey?: `0x${string}`;
};

export type LedgerBalance = { asset: string; amount: string };
export type AppSession = {
  appSessionId: string;
  application: string;
  status: string;
  participants: string[];
  protocol: string;
  challenge: number;
  weights: number[];
  quorum: number;
  version: number;
  nonce: number;
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
  sessionData?: string;
};

export class YellowRpcClient {
  private ws?: WebSocket;
  private requestId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  private authenticated = false;
  private sessionPrivateKey?: `0x${string}`;

  constructor(private options: NitroRpcOptions) {}

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.ws = new WebSocket(this.options.url);
    this.ws.on('message', (data: WebSocket.Data) =>
      this.handleMessage(Buffer.from(data as Uint8Array).toString()),
    );
    this.ws.on('error', error => {
      console.error('Yellow RPC socket error:', error);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Yellow RPC connection timeout')), 10_000);
      this.ws?.once('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.ws?.once('close', () => {
        clearTimeout(timeout);
        reject(new Error('Yellow RPC connection closed'));
      });
    });
  }

  async request<T>(method: string, params: Record<string, unknown>, sign = false): Promise<T> {
    await this.connect();

    const id = this.requestId++;
    const req: NitroRpcRequest['req'] = [id, method, params, Date.now()];
    const sig = sign ? [await signPayload(req, this.options.privateKey ?? '')] : [];
    const payload: NitroRpcRequest = { req, sig };
    const message = JSON.stringify(payload);

    const response = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Yellow RPC timeout for ${method}`));
      }, this.options.timeoutMs ?? 15000);

      this.pending.set(id, {
        resolve: value => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: err => {
          clearTimeout(timeout);
          reject(err);
        },
      });
    });

    if (this.options.debug) {
      console.error('[yellow-rpc] send', message);
    }
    this.ws?.send(message);
    return response;
  }

  async authenticate(options: AuthOptions = {}): Promise<void> {
    if (this.authenticated) {
      return;
    }

    if (!this.options.privateKey) {
      throw new Error('Missing private key for authentication');
    }

    const account = privateKeyToAccount(this.options.privateKey as `0x${string}`);
    const sessionPrivateKey = options.sessionPrivateKey ?? generatePrivateKey();
    const sessionAccount = privateKeyToAccount(sessionPrivateKey);
    const walletClient = createWalletClient({
      account,
      transport: custom({
        request: async () => {
          throw new Error('RPC transport not configured for signing');
        },
      }),
    });

    const authParams = {
      address: account.address,
      session_key: sessionAccount.address,
      application: options.application ?? 'eXpress402-mcp',
      allowances: options.allowances ?? [],
      // Yellow expects seconds since epoch (not ms).
      expires_at: BigInt(
        Math.floor(Date.now() / 1000) + Math.floor((options.expiresInMs ?? 1000 * 60 * 60) / 1000),
      ),
      scope: options.scope ?? '*',
    };

    const candidateDomains = [
      this.options.authDomain,
      'Nitrolite',
      'Yellow Network',
      'Yellow',
      'NitroRPC',
      authParams.application,
    ].filter((value, index, self) => value && self.indexOf(value) === index) as string[];

    for (const domainName of candidateDomains) {
      const authRequestMessage = await createAuthRequestMessage(authParams);
      const authResponse = (await this.sendRaw(authRequestMessage)) as Record<string, unknown>;
      const challengeMessage =
        authResponse.challengeMessage ?? authResponse.challenge_message ?? authResponse.challenge;

      if (!challengeMessage) {
        continue;
      }

      const signer = createEIP712AuthMessageSigner(
        walletClient,
        {
          scope: authParams.scope,
          session_key: authParams.session_key,
          expires_at: authParams.expires_at,
          allowances: authParams.allowances,
        },
        { name: domainName },
      );

      const authVerifyMessage = await createAuthVerifyMessageFromChallenge(
        signer,
        challengeMessage as string,
      );
      try {
        const verifyResponse = (await this.sendRaw(authVerifyMessage)) as Record<string, unknown>;
        if (verifyResponse?.success === true) {
          this.sessionPrivateKey = sessionPrivateKey;
          this.authenticated = true;
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('invalid challenge') && !message.includes('invalid signature')) {
          throw error;
        }
      }

      const ecdsaSigner = createECDSAMessageSigner(this.options.privateKey as `0x${string}`);
      const authVerifyEcdsa = await createAuthVerifyMessageFromChallenge(
        ecdsaSigner,
        challengeMessage as string,
      );
      try {
        const verifyResponse = (await this.sendRaw(authVerifyEcdsa)) as Record<string, unknown>;
        if (verifyResponse?.success === true) {
          this.sessionPrivateKey = sessionPrivateKey;
          this.authenticated = true;
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('invalid challenge') && !message.includes('invalid signature')) {
          throw error;
        }
      }
    }

    const selfAuthParams = {
      ...authParams,
      session_key: account.address,
    };
    const authRequestMessage = await createAuthRequestMessage(selfAuthParams);
    const authResponse = (await this.sendRaw(authRequestMessage)) as Record<string, unknown>;
    const challengeMessage =
      authResponse.challengeMessage ?? authResponse.challenge_message ?? authResponse.challenge;
    if (!challengeMessage) {
      throw new Error('Auth challenge missing from response');
    }

    const ecdsaSigner = createECDSAMessageSigner(this.options.privateKey as `0x${string}`);
    const authVerifyEcdsa = await createAuthVerifyMessageFromChallenge(
      ecdsaSigner,
      challengeMessage as string,
    );
    const verifyResponse = (await this.sendRaw(authVerifyEcdsa)) as Record<string, unknown>;
    if (verifyResponse?.success === true) {
      this.sessionPrivateKey = undefined;
      this.authenticated = true;
      return;
    }

    throw new Error('Authentication failed');
  }

  async transfer(params: {
    destination: `0x${string}`;
    allocations: Array<{ asset: string; amount: string }>;
  }) {
    if (!this.options.privateKey) {
      throw new Error('Missing private key for transfer');
    }
    await this.authenticate();

    const signingKey = this.sessionPrivateKey ?? (this.options.privateKey as `0x${string}`);
    const signer = createECDSAMessageSigner(signingKey);
    const message = await createTransferMessage(signer, params);
    return await this.sendRaw(message);
  }

  async getLedgerBalances(accountId?: string): Promise<LedgerBalance[]> {
    if (!this.options.privateKey) {
      const response = await this.request<{
        ledgerBalances?: LedgerBalance[];
        ledger_balances?: LedgerBalance[];
      }>('get_ledger_balances', {
        ...(accountId ? { account_id: accountId } : {}),
      });
      return response.ledgerBalances ?? response.ledger_balances ?? [];
    }

    await this.authenticate();
    const signingKey = this.sessionPrivateKey ?? (this.options.privateKey as `0x${string}`);
    const signer = createECDSAMessageSigner(signingKey);
    const message = await createGetLedgerBalancesMessage(signer, accountId);
    const response = (await this.sendRaw(message)) as {
      ledgerBalances?: LedgerBalance[];
      ledger_balances?: LedgerBalance[];
    };
    return response.ledgerBalances ?? response.ledger_balances ?? [];
  }

  async getAppSessions(participant: `0x${string}`, status?: string): Promise<AppSession[]> {
    const message = createGetAppSessionsMessageV2(participant, status as any);
    const response = (await this.sendRaw(message)) as Record<string, unknown>;
    return (response?.appSessions ?? []) as AppSession[];
  }

  async closeAppSession(params: {
    appSessionId: `0x${string}`;
    allocations: Array<{ asset: string; amount: string; participant: `0x${string}` }>;
    sessionData?: string;
  }) {
    if (!this.options.privateKey) {
      throw new Error('Missing private key for close_app_session');
    }
    await this.authenticate();
    const signingKey = this.sessionPrivateKey ?? (this.options.privateKey as `0x${string}`);
    const signer = createECDSAMessageSigner(signingKey);
    const message = await createCloseAppSessionMessage(signer, {
      app_session_id: params.appSessionId,
      allocations: params.allocations,
      ...(params.sessionData ? { session_data: params.sessionData } : {}),
    });
    return await this.sendRaw(message);
  }

  private handleMessage(raw: string) {
    let parsed: NitroRpcResponse;
    try {
      parsed = JSON.parse(raw) as NitroRpcResponse;
    } catch (error) {
      console.error('Failed to parse Yellow RPC message:', error);
      return;
    }

    if (this.options.debug) {
      console.error('[yellow-rpc] recv', raw);
    }

    if (!parsed.res) {
      return;
    }

    const [requestId, method, result] = parsed.res;
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }

    if (method === 'error') {
      const message =
        typeof result === 'object' && result !== null && 'error' in result
          ? String((result as { error: string }).error)
          : 'Unknown Yellow RPC error';
      pending.reject(new Error(message));
    } else {
      pending.resolve(result);
    }
    this.pending.delete(requestId);
  }

  private async sendRaw(message: string) {
    await this.connect();
    const parsed = JSON.parse(message) as NitroRpcRequest;
    const id = parsed.req?.[0];
    if (typeof id !== 'number') {
      throw new Error('Invalid request ID in message');
    }

    const response = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Yellow RPC timeout for request ${id}`));
      }, this.options.timeoutMs ?? 15000);

      this.pending.set(id, {
        resolve: value => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: err => {
          clearTimeout(timeout);
          reject(err);
        },
      });
    });

    if (this.options.debug) {
      console.error('[yellow-rpc] sendRaw', message);
    }
    this.ws?.send(message);
    return response;
  }

  async sendRawMessage(message: string) {
    return this.sendRaw(message);
  }
}
