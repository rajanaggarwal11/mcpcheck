// The low-level Server, so tools/list can return schemas McpServer would never produce.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
const server = new Server({ name: "bad-schema-server", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "requires_ghost", description: "Requires b.", inputSchema: { type: "object", properties: { a: { type: "string" } }, required: ["a", "b"] } },
    { name: "untyped_param", description: "x has no type.", inputSchema: { type: "object", properties: { x: {} } } },
    { name: "accepts_anything", description: "No params, no limit.", inputSchema: { type: "object" } },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "noop" }] }));
await server.connect(new StdioServerTransport());
