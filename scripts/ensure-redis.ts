#!/usr/bin/env tsx
/**
 * Ensure Redis is running for development
 * Starts Redis container if not already running
 */
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const REDIS_CONTAINER_NAME = 'eXpress402-redis-dev';
const REDIS_IMAGE = 'redis:7-alpine';
const REDIS_PORT = '6379';

async function isRedisRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`docker ps --filter name=${REDIS_CONTAINER_NAME} --format "{{.Names}}"`);
    return stdout.trim() === REDIS_CONTAINER_NAME;
  } catch {
    return false;
  }
}

async function startRedis(): Promise<void> {
  console.error('[Redis] Starting Redis container...');
  
  try {
    // Check if container exists but is stopped
    const { stdout } = await execAsync(`docker ps -a --filter name=${REDIS_CONTAINER_NAME} --format "{{.Names}}"`);
    
    if (stdout.trim() === REDIS_CONTAINER_NAME) {
      // Container exists, just start it
      await execAsync(`docker start ${REDIS_CONTAINER_NAME}`);
      console.error('[Redis] Started existing container');
    } else {
      // Create new container
      await execAsync(`docker run -d --name ${REDIS_CONTAINER_NAME} -p ${REDIS_PORT}:6379 ${REDIS_IMAGE}`);
      console.error('[Redis] Created and started new container');
    }
    
    // Wait for Redis to be ready
    console.error('[Redis] Waiting for Redis to be ready...');
    for (let i = 0; i < 10; i++) {
      try {
        await execAsync(`docker exec ${REDIS_CONTAINER_NAME} redis-cli ping`);
        console.error('[Redis] Ready at localhost:6379\n');
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.error('[Redis] Warning: Redis may not be ready yet\n');
  } catch (error) {
    console.error('[Redis] Failed to start:', error);
    console.error('[Redis] Continuing without Redis (will use fallback)\n');
  }
}

async function main() {
  const running = await isRedisRunning();
  
  if (running) {
    console.error('[Redis] Already running at localhost:6379\n');
  } else {
    await startRedis();
  }
}

main().catch(console.error);
