import { serve, z, ok } from "./_stdio.mjs";
await serve("clean-server", "1.0.0", (s) => {
  s.registerTool("get_weather", {
    description: "Current weather for a city.",
    inputSchema: { city: z.string().describe("City name") },
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, ok("sunny"));
  s.registerTool("list_files", {
    description: "Files in one of the allowed folders.",
    inputSchema: { dir: z.enum(["docs", "src"]) },
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, ok("[]"));
  s.registerTool("create_note", {
    description: "Saves a note.",
    inputSchema: { title: z.string(), body: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, ok("saved"));
});
