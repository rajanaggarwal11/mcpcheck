import type { Finding, Inspection, Rule } from "../types.js";

/**
 * No annotations at all means the client has nothing to go on but the name.
 * Some clients then confirm everything, which trains the human to click
 * through; others confirm nothing. Either way the server has declined to say.
 */
export const missingAnnotations: Rule = {
  id: "missing-annotations",
  title: "Tool declares no behavioural hints",
  description:
    "A tool with no readOnlyHint / destructiveHint, so a client cannot tell whether to ask the human first.",
  defaultSeverity: "warn",
  check(inspection: Inspection): Finding[] {
    const findings: Finding[] = [];
    for (const tool of inspection.tools) {
      const a = tool.annotations;
      const declared = a && (a.readOnlyHint !== undefined || a.destructiveHint !== undefined);
      if (!declared) {
        findings.push({
          rule: missingAnnotations.id,
          severity: "warn",
          tool: tool.name,
          message: "declares neither readOnlyHint nor destructiveHint",
        });
      }
    }
    return findings;
  },
};
