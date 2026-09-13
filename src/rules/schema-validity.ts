import type { Finding, Inspection, JsonSchema, Rule } from "../types.js";

/**
 * The input schema is the model's only description of how to call the tool.
 * A schema that is structurally wrong — required fields that don't exist,
 * properties with no type — is a call the model cannot make correctly, and
 * the server's validation (if any) is the only thing that will notice.
 */
export const schemaValidity: Rule = {
  id: "schema-validity",
  title: "Input schema is structurally unsound",
  description:
    "An inputSchema that is not an object schema, requires properties it does not define, or leaves a property untyped.",
  defaultSeverity: "error",
  check(inspection: Inspection): Finding[] {
    const findings: Finding[] = [];
    for (const tool of inspection.tools) {
      const s = tool.inputSchema;
      const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
      if (!types.includes("object")) {
        findings.push({
          rule: schemaValidity.id,
          severity: "error",
          tool: tool.name,
          message: `inputSchema.type is ${JSON.stringify(s.type ?? null)}; MCP tool inputs must be an object`,
        });
        continue;
      }
      const props = s.properties ?? {};
      const missing = (s.required ?? []).filter((r) => !(r in props));
      if (missing.length) {
        findings.push({
          rule: schemaValidity.id,
          severity: "error",
          tool: tool.name,
          message: `requires ${missing.map((m) => `"${m}"`).join(", ")} but defines no such propert${missing.length > 1 ? "ies" : "y"}`,
        });
      }
      for (const [name, p] of Object.entries(props)) {
        const ps = p as JsonSchema;
        const typed =
          "type" in ps ||
          "$ref" in ps ||
          "enum" in ps ||
          "const" in ps ||
          "oneOf" in ps ||
          "anyOf" in ps ||
          "allOf" in ps;
        if (!typed) {
          findings.push({
            rule: schemaValidity.id,
            severity: "warn",
            tool: tool.name,
            message: `parameter "${name}" has no type — the model has to guess what to send`,
          });
        }
      }
      // `properties: {}` is what the SDK emits for a tool that takes nothing, and
      // is explicit. Only a schema with no `properties` key AT ALL says nothing
      // about its inputs.
      if (!("properties" in s) && s.additionalProperties !== false) {
        findings.push({
          rule: schemaValidity.id,
          severity: "warn",
          tool: tool.name,
          message:
            "declares no properties at all and does not forbid extra ones — accepts anything",
        });
      }
    }
    return findings;
  },
};
