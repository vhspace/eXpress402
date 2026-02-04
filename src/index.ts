/**
 * Load .env before any other imports
 * Use override: true to override empty env vars from devcontainer
 */
import { config } from 'dotenv';
config({ override: true });
import { startMcpServer } from './mcp/server.js';

console.error('Starting MCP server...');
startMcpServer()
  .then(() => {
    console.error('MCP server started successfully');
  })
  .catch(error => {
    console.error('Fatal error starting MCP server:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  });
