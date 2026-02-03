#!/usr/bin/env tsx
/**
 * One-command development setup for eXpress402
 * Run: npm run setup
 * 
 * Automatically configures:
 * - Agent wallet (for AI agent)
 * - Merchant wallet (for receiving payments)
 * - Funds wallets via Yellow faucet
 */
import { existsSync, readFileSync, copyFileSync, writeFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const execAsync = promisify(exec);

const SANDBOX_FAUCET_URL = 'https://clearnet-sandbox.yellow.com/faucet/requestTokens';
const MIN_BALANCE_THRESHOLD = 10; // ytest.usd

async function main() {
  console.log('\neXpress402 Development Setup');
  console.log('================================\n');

  // Check if .env exists
  if (!existsSync('.env')) {
    console.log('Creating .env from .env.example...');
    copyFileSync('.env.example', '.env');
    console.log('Success: .env created\n');
  }

  let envContent = readFileSync('.env', 'utf-8');

  // Generate agent wallet if needed
  const hasAgentKey = envContent.includes('YELLOW_AGENT_PRIVATE_KEY=0x');
  let agentAddress: string | undefined;

  if (!hasAgentKey) {
    console.log('Generating AI agent wallet...');
    const agentPrivateKey = generatePrivateKey();
    const agentAccount = privateKeyToAccount(agentPrivateKey);
    agentAddress = agentAccount.address;

    envContent = updateEnvVar(envContent, 'YELLOW_AGENT_PRIVATE_KEY', agentPrivateKey);
    envContent = updateEnvVar(envContent, 'YELLOW_AGENT_ADDRESS', agentAddress);
    writeFileSync('.env', envContent);

    console.log(`Agent wallet created: ${agentAddress}\n`);
  } else {
    agentAddress = envContent.match(/YELLOW_AGENT_ADDRESS=(0x[a-fA-F0-9]+)/)?.[1];
    console.log(`Agent wallet already configured: ${agentAddress}\n`);
  }

  // Generate merchant wallet if needed (for testing)
  const hasMerchantAddress = envContent.includes('YELLOW_MERCHANT_ADDRESS=0x');
  let merchantAddress: string | undefined;

  if (!hasMerchantAddress) {
    console.log('Generating merchant wallet (for testing)...');
    const merchantPrivateKey = generatePrivateKey();
    const merchantAccount = privateKeyToAccount(merchantPrivateKey);
    merchantAddress = merchantAccount.address;

    envContent = readFileSync('.env', 'utf-8'); // Reload after agent wallet update
    envContent = updateEnvVar(envContent, 'YELLOW_MERCHANT_ADDRESS', merchantAddress);
    envContent = updateEnvVar(envContent, 'YELLOW_MERCHANT_PRIVATE_KEY', merchantPrivateKey);
    writeFileSync('.env', envContent);

    console.log(`Merchant wallet created: ${merchantAddress}\n`);
  } else {
    merchantAddress = envContent.match(/YELLOW_MERCHANT_ADDRESS=(0x[a-fA-F0-9]+)/)?.[1];
    console.log(`Merchant wallet already configured: ${merchantAddress}\n`);
  }

  // Check Redis connection (if in devcontainer)
  try {
    await execAsync('redis-cli ping');
    console.log('Redis is ready at localhost:6379\n');
  } catch {
    console.log('Redis not responding (will start with devcontainer)\n');
  }

  // Install dependencies
  console.log('Installing dependencies...');
  await execAsync('npm install');
  console.log('');

  console.log('');

  // Check balance and auto-fund
  const finalEnvContent = readFileSync('.env', 'utf-8');
  const clearnodeUrl =
    finalEnvContent.match(/YELLOW_CLEARNODE_URL=([^\n]+)/)?.[1] ||
    'wss://clearnet-sandbox.yellow.com/ws';
  const isDevelopment = clearnodeUrl.includes('sandbox');

  if (agentAddress && isDevelopment) {
    console.log('Checking Yellow Network balance...');
    try {
      // Check balance via Yellow RPC
      const { YellowRpcClient } = await import('../src/yellow/rpc.js');
      const yellow = new YellowRpcClient({ url: clearnodeUrl });
      await yellow.connect();
      const balances = await yellow.getLedgerBalances(agentAddress);
      const ytestBalance = balances.find((b: any) => b.asset === 'ytest.usd');
      const currentBalance = Number(ytestBalance?.amount ?? '0');

      console.log(`Current balance: ${currentBalance} ytest.usd\n`);

      if (currentBalance < MIN_BALANCE_THRESHOLD) {
        console.log(`Balance below ${MIN_BALANCE_THRESHOLD}, auto-funding from Yellow faucet...`);
        const response = await fetch(SANDBOX_FAUCET_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userAddress: agentAddress }),
        });

        if (response.ok) {
          console.log('Faucet request successful! Waiting for funds...');
          await new Promise(resolve => setTimeout(resolve, 3000));

          // Check new balance
          const newBalances = await yellow.getLedgerBalances(agentAddress);
          const newYtestBalance = newBalances.find((b: any) => b.asset === 'ytest.usd');
          const newBalance = Number(newYtestBalance?.amount ?? '0');
          console.log(`New balance: ${newBalance} ytest.usd\n`);
        } else {
          const errorText = await response.text();
          console.log(`Faucet request failed: ${errorText}`);
          console.log('Manual funding required - see instructions below\n');
        }
      } else {
        console.log('Balance sufficient for testing\n');
      }

      await yellow.disconnect();
    } catch (error) {
      console.log('Could not check balance (Yellow RPC may not be available yet)');
      console.log('Manual funding may be required - see instructions below\n');
    }
  }

  console.log('Setup Complete!\n');
  console.log('Next steps:');
  console.log('===========\n');

  if (agentAddress) {
    console.log('If manual funding is needed:');
    console.log(`   Wallet: ${agentAddress}`);
    console.log('   Yellow Faucet: https://faucet.yellow.org/');
    console.log('   Asset: ytest.usd (sandbox test token)');
    console.log('');
  }
  console.log('Run demo: npm run demo:siwx');
  console.log('Start MCP server: npm run dev\n');
}

/**
 * Helper to update or add environment variable in .env content
 */
function updateEnvVar(content: string, key: string, value: string): string {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, `${key}=${value}`);
  }
  return content + `\n${key}=${value}`;
}

main().catch(error => {
  console.error('Setup failed:', error);
  process.exit(1);
});
