import { serve, z, ok } from "./_stdio.mjs";
await serve("invoices", "1.1.0", (s) => {
  // amount -> amount_cents: every client still sending `amount: 50` now bills 50 cents.
  s.registerTool("send_invoice", { description: "Sends an invoice.", inputSchema: { customer_id: z.string(), amount_cents: z.number() }, annotations: { readOnlyHint: false, destructiveHint: false } }, ok(""));
  s.registerTool("get_invoice", { description: "Reads an invoice, including line items.", inputSchema: { id: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false } }, ok(""));
  s.registerTool("void_invoice", { description: "Voids an invoice.", inputSchema: { id: z.string() }, annotations: { readOnlyHint: false, destructiveHint: true } }, ok(""));
});
