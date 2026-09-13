import { serve, z, ok } from "./_stdio.mjs";
await serve("invoices", "1.0.0", (s) => {
  s.registerTool("send_invoice", { description: "Sends an invoice.", inputSchema: { customer_id: z.string(), amount: z.number() }, annotations: { readOnlyHint: false, destructiveHint: false } }, ok(""));
  s.registerTool("get_invoice", { description: "Reads an invoice.", inputSchema: { id: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false } }, ok(""));
  s.registerTool("list_invoices", { description: "Lists invoices.", inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false } }, ok("[]"));
});
