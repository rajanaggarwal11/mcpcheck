import type { Finding, Inspection, Rule } from "../types.js";

const DESTRUCTIVE =
  /^(delete|remove|rm|drop|destroy|purge|wipe|truncate|erase|reset|kill|revoke|unpublish|cancel|terminate|clear)([_\-.]|$)/i;
const WRITES =
  /^(create|write|update|set|put|post|send|insert|add|upload|modify|edit|patch|move|rename|save|append|push|publish|deploy|exec|execute|start|stop|restart|enable|disable|assign|merge|commit|apply)([_\-.]|$)/i;
const READS =
  /^(get|list|read|fetch|search|find|query|describe|show|lookup|check|count|view|inspect|status|info|browse|ls)([_\-.]|$)/i;

/**
 * Annotations are what a client uses to decide whether to ask the human first.
 * A tool that says it is read-only and isn't makes the client skip that
 * confirmation. The name is the only other signal there is, so this rule holds
 * the two against each other. It is a heuristic and says so — the point is to
 * make a human look, not to convict.
 */
export const annotationHonesty: Rule = {
  id: "annotation-honesty",
  title: "Annotations contradict what the tool's name says it does",
  description:
    "A tool named like a write or a delete that claims to be read-only or non-destructive, or the reverse.",
  defaultSeverity: "error",
  check(inspection: Inspection): Finding[] {
    const findings: Finding[] = [];
    for (const tool of inspection.tools) {
      const a = tool.annotations;
      if (!a) continue;
      const verb = (DESTRUCTIVE.exec(tool.name) ??
        WRITES.exec(tool.name) ??
        READS.exec(tool.name))?.[1];

      if (DESTRUCTIVE.test(tool.name)) {
        if (a.readOnlyHint === true) {
          findings.push({
            rule: annotationHonesty.id,
            severity: "error",
            tool: tool.name,
            message: `named like a delete ("${verb}") but annotated readOnlyHint: true — a client will skip confirmation`,
          });
        }
        if (a.destructiveHint === false) {
          findings.push({
            rule: annotationHonesty.id,
            severity: "error",
            tool: tool.name,
            message: `named like a delete ("${verb}") but annotated destructiveHint: false`,
          });
        }
      } else if (WRITES.test(tool.name)) {
        if (a.readOnlyHint === true) {
          findings.push({
            rule: annotationHonesty.id,
            severity: "error",
            tool: tool.name,
            message: `named like a write ("${verb}") but annotated readOnlyHint: true — a client will skip confirmation`,
          });
        }
      } else if (READS.test(tool.name)) {
        if (a.destructiveHint === true) {
          findings.push({
            rule: annotationHonesty.id,
            severity: "warn",
            tool: tool.name,
            message: `named like a read ("${verb}") but annotated destructiveHint: true — clients will over-confirm, or the name is misleading`,
          });
        }
      }

      if (a.readOnlyHint === true && a.destructiveHint === true) {
        findings.push({
          rule: annotationHonesty.id,
          severity: "error",
          tool: tool.name,
          message:
            "annotated both readOnlyHint: true and destructiveHint: true — it cannot be both",
        });
      }
    }
    return findings;
  },
};
