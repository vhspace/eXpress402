#!/usr/bin/env tsx
/**
 * Generate a new wallet for AI agents
 * Run: npm run generate-wallet
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';

async function generateWallet() {
  console.log('\nGenerating AI Agent Wallet...\n');

  // Generate new wallet
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  console.log('Wallet Generated Successfully!');
  console.log('================================');
  console.log(`Address:     ${account.address}`);
  console.log(`Private Key: ${privateKey}`);
  console.log('================================\n');

  // Check if .env exists
  const envPath = '.env';
  const envExists = existsSync(envPath);

  if (!envExists) {
    // Create new .env from example
    const exampleEnv = await readFile('.env.example', 'utf-8');
    await writeFile(envPath, exampleEnv);
    console.log('Created .env file from .env.example\n');
  }

  // Read current .env
  let envContent = await readFile(envPath, 'utf-8');

  // Update or add agent keys
  if (envContent.includes('YELLOW_AGENT_PRIVATE_KEY=')) {
    envContent = envContent.replace(
      /YELLOW_AGENT_PRIVATE_KEY=.*/,
      `YELLOW_AGENT_PRIVATE_KEY=${privateKey}`,
    );
  } else {
    envContent += `\nYELLOW_AGENT_PRIVATE_KEY=${privateKey}`;
  }

  if (envContent.includes('YELLOW_AGENT_ADDRESS=')) {
    envContent = envContent.replace(
      /YELLOW_AGENT_ADDRESS=.*/,
      `YELLOW_AGENT_ADDRESS=${account.address}`,
    );
  } else {
    envContent += `\nYELLOW_AGENT_ADDRESS=${account.address}`;
  }

  await writeFile(envPath, envContent);

  console.log('Updated .env with agent wallet\n');
  console.log('SECURITY: Keep .env file secret! Never commit to git.');
  console.log('\nNext step: Run npm run setup to auto-fund wallet');
  console.log('(setup script will auto-request funds from Yellow faucet if balance < 10)');
  console.log('\nOr fund manually:');
  console.log('  Yellow Faucet: https://faucet.yellow.org/');
  console.log(`  Wallet: ${account.address}`);
  console.log('  Asset: ytest.usd (sandbox test token)\n');
}

generateWallet().catch(console.error);
