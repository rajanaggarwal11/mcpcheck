// Shared boot for fixture servers: build with McpServer, serve over stdio.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
export { z } from "zod";
export async function serve(name, version, register, options = {}) {
  const server = new McpServer({ name, version }, options);
  register(server);
  await server.connect(new StdioServerTransport());
}
export const ok = (text) => async () => ({ content: [{ type: "text", text }] });
