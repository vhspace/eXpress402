import { startMcpServer } from "./mcp/server.js";

startMcpServer().catch((error) => {
  console.error("Fatal error starting MCP server:", error);
  process.exit(1);
});
