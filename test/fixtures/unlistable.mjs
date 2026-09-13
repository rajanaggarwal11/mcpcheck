// The low-level Server, so tools/list can return schemas McpServer would never produce.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
const server = new Server({ name: "unlistable-server", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "fine", description: "A normal tool.", inputSchema: { type: "object", properties: {} } },
    // One tool with a non-object schema. The SDK rejects the entire list.
    { name: "not_an_object", description: "Takes a string.", inputSchema: { type: "string" } },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "noop" }] }));
await server.connect(new StdioServerTransport());
