import type { Finding, Inspection, Rule } from "../types.js";

/**
 * A name that can only mean a shell. `execute_functionality` or `run_report`
 * are not on this list on purpose: "execute" and "run" name half the tools on
 * npm, and a bare verb convicts nothing — it takes a command-shaped parameter
 * as well (below).
 */
const SHELL_NAME =
  /(^|[_\-.])(shell|bash|zsh|sh|powershell|terminal|eval|system_command|shell_command)([_\-.]|$)|(^|[_\-.])(run|exec|execute)[_\-.](command|commands|cmd|shell)([_\-.]|$)/i;
const SHELL_PARAM = /^(command|cmd|script|shell|code|expression|bash|sh)$/i;
const SHELL_VERB = /\b(run|runs|exec|execute|executes|shell|command|cmd|terminal|system)\b/i;
/**
 * "arbitrary code" and "any command" describe a terminal. "any code" does not —
 * an authorization code, a status code, "any code returned" — so `code` needs
 * "arbitrary" or an executing verb in front of it.
 */
const SHELL_DESC =
  /\barbitrary\s+(shell\s+|system\s+|terminal\s+)?(command|code|script)s?\b|\bany\s+(shell\s+|system\s+|terminal\s+)?(command|script)s?\b|\bruns?\s+(a\s+)?(shell|bash|system)\s+command|\b(execute|run|eval|evaluate)s?\s+(arbitrary\s+|any\s+|user[- ]provided\s+)?(javascript|python|code)\b/i;

const WRITE_NAME =
  /(^|[_\-.])(write|delete|remove|rm|unlink|move|mv|rename|chmod|chown|truncate|overwrite|append)([_\-.]|$)/i;
const PATH_PARAM =
  /^(path|file|filepath|file_path|filename|dir|directory|dest|destination|target)$/i;

/**
 * A tool the model can point anywhere. Not a bug in the server — a property of
 * it, which the person wiring it into an agent should know about before the
 * agent does. Executing arbitrary commands is an error; unrestricted file
 * writes are a warning, because sometimes that is genuinely the tool's job.
 */
export const overBroadTool: Rule = {
  id: "over-broad-tool",
  title: "Tool grants the model open-ended power",
  description:
    "A tool that executes arbitrary commands or code, or writes to any path the model chooses.",
  defaultSeverity: "error",
  check(inspection: Inspection): Finding[] {
    const findings: Finding[] = [];
    for (const tool of inspection.tools) {
      const props = Object.keys(tool.inputSchema.properties ?? {});
      const desc = tool.description ?? "";

      const shellByName = SHELL_NAME.test(tool.name);
      const shellByParam = props.find((p) => SHELL_PARAM.test(p));
      const shellByDesc = SHELL_DESC.test(desc);
      if (shellByName || shellByDesc || (shellByParam && SHELL_VERB.test(tool.name + " " + desc))) {
        findings.push({
          rule: overBroadTool.id,
          severity: "error",
          tool: tool.name,
          message: "executes arbitrary commands or code — the model has a terminal",
          detail: [
            shellByName
              ? `the name matches ${SHELL_NAME.exec(tool.name)![0].replace(/[_\-.]/g, "")}`
              : "",
            shellByParam ? `takes a "${shellByParam}" parameter` : "",
            shellByDesc ? `the description says so: "${SHELL_DESC.exec(desc)![0]}"` : "",
          ].filter(Boolean),
        });
        continue;
      }

      const pathParam = props.find((p) => PATH_PARAM.test(p));
      if (pathParam && WRITE_NAME.test(tool.name)) {
        const schema = tool.inputSchema.properties?.[pathParam] ?? {};
        const constrained = "enum" in schema || "pattern" in schema || "const" in schema;
        if (!constrained) {
          findings.push({
            rule: overBroadTool.id,
            severity: "warn",
            tool: tool.name,
            message: `writes to any path the model chooses — "${pathParam}" is an unconstrained string`,
            detail: [
              "constrain it with an enum or a pattern, or document that the server sandboxes it",
            ],
          });
        }
      }
    }
    return findings;
  },
};
