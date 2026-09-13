import { serve, z, ok } from "./_stdio.mjs";
await serve("broad-server", "1.0.0", (s) => {
  s.registerTool("run_command", {
    description: "Runs a shell command on the host.",
    inputSchema: { command: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, ok(""));
  s.registerTool("write_file", {
    description: "Writes content to a file.",
    inputSchema: { path: z.string(), content: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, ok(""));
  s.registerTool("write_config", {
    description: "Writes one of the known config files.",
    inputSchema: { path: z.enum(["app.json", "db.json"]), content: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, ok(""));
});
