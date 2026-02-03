#!/usr/bin/env tsx
/**
 * One-command development setup for eXpress402
 * Run: npm run setup
 */
import { existsSync, readFileSync, copyFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function main() {
  console.log('\neXpress402 Development Setup');
  console.log('================================\n');

  // Check if .env exists
  if (!existsSync('.env')) {
    console.log('Creating .env from .env.example...');
    copyFileSync('.env.example', '.env');
    console.log('Success: .env created\n');
  }

  // Check if agent wallet exists
  const envContent = readFileSync('.env', 'utf-8');
  const hasAgentKey = envContent.includes('YELLOW_AGENT_PRIVATE_KEY=0x');

  if (!hasAgentKey) {
    console.log('Generating AI agent wallet...');
    await execAsync('npm run generate-wallet');
    console.log('');
  } else {
    console.log('Agent wallet already configured\n');
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

  console.log('Setup Complete!\n');
  console.log('Next steps:');
  console.log('===========\n');

  // Extract agent address
  const updatedEnvContent = readFileSync('.env', 'utf-8');
  const agentAddress = updatedEnvContent.match(/YELLOW_AGENT_ADDRESS=(0x[a-fA-F0-9]+)/)?.[1];

  if (agentAddress) {
    console.log('1. Fund your agent wallet with Yellow Network test tokens:');
    console.log(`   Wallet: ${agentAddress}`);
    console.log('');
    console.log('   Yellow Faucet: https://faucet.yellow.org/');
    console.log(`   Or via API: curl -X POST https://clearnet-sandbox.yellow.com/faucet/requestTokens \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"userAddress":"${agentAddress}"}'`);
    console.log('');
  }
  console.log('2. Run demo: npm run demo:siwx');
  console.log('3. Start MCP server: npm run dev\n');
}

main().catch(error => {
  console.error('Setup failed:', error);
  process.exit(1);
});
