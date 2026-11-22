// Reports its own command-line arguments in the instructions field, so a test can
// see exactly what mcpcheck passed through to the server.
import { serve, z, ok } from "./_stdio.mjs";
await serve(
  "argv-server",
  "1.0.0",
  (s) => {
    s.registerTool("get_weather", {
      description: "Current weather for a city.",
      inputSchema: { city: z.string().describe("City name") },
      annotations: { readOnlyHint: true, destructiveHint: false },
    }, ok("sunny"));
  },
  { instructions: JSON.stringify(process.argv.slice(2)) },
);
