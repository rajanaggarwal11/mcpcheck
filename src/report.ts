import pc from "picocolors";
import type { CheckResult, Finding } from "./types.js";

export interface ReportOptions {
  /** Print info-severity findings (snapshot written, version changed). Default true. */
  info?: boolean;
}

const label = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function render(f: Finding): string[] {
  const glyph =
    f.severity === "error" ? pc.red("✗") : f.severity === "warn" ? pc.yellow("!") : pc.cyan("i");
  const head = f.tool ? `${pc.bold(f.tool)} ${pc.dim("—")} ${f.message}` : f.message;
  return [`  ${glyph} ${head}`, ...(f.detail ?? []).map((d) => pc.dim(`      ${d}`))];
}

/** The human-readable report. Findings arrive severity-ordered; grouped by rule without disturbing that. */
export function formatReport(result: CheckResult, options: ReportOptions = {}): string {
  const { inspection, findings } = result;
  const out: string[] = [];

  out.push(
    [
      pc.bold("mcpcheck"),
      pc.dim(`${inspection.server.name} ${inspection.server.version}`),
      pc.dim(label(inspection.tools.length, "tool", "tools")),
      pc.dim(inspection.target),
    ].join(pc.dim(" · ")),
  );
  out.push("");

  const shown = findings.filter((f) => f.severity !== "info" || options.info !== false);
  const problems = shown.filter((f) => f.severity !== "info");

  if (problems.length === 0) {
    out.push(
      `${pc.green("✓")} No problems found across ${label(inspection.tools.length, "tool", "tools")}.`,
    );
    for (const f of shown.filter((f) => f.severity === "info")) out.push(...render(f));
    out.push("");
    return out.join("\n");
  }

  const groups = new Map<string, Finding[]>();
  for (const f of shown) (groups.get(f.rule) ?? groups.set(f.rule, []).get(f.rule)!).push(f);

  for (const [rule, group] of groups) {
    const sev = group.find((g) => g.severity !== "info")?.severity ?? "info";
    const tag =
      sev === "error"
        ? pc.bgRed(pc.black(" error "))
        : sev === "warn"
          ? pc.bgYellow(pc.black(" warn "))
          : pc.bgCyan(pc.black(" info "));
    out.push(`${tag} ${pc.bold(rule)}`);
    for (const f of group) out.push(...render(f));
    out.push("");
  }

  const errors = problems.filter((f) => f.severity === "error").length;
  const warnings = problems.length - errors;
  out.push(pc.dim("─".repeat(48)));
  out.push(
    `${pc.bold(label(problems.length, "finding", "findings"))}: ` +
      `${errors ? pc.red(label(errors, "error", "errors")) : label(errors, "error", "errors")}, ` +
      `${warnings ? pc.yellow(label(warnings, "warning", "warnings")) : label(warnings, "warning", "warnings")}`,
  );
  out.push("");
  return out.join("\n");
}

/** The machine-readable report. Shape is part of the public contract. */
export function formatJson(result: CheckResult): string {
  const problems = result.findings.filter((f) => f.severity !== "info");
  const errors = problems.filter((f) => f.severity === "error").length;
  return `${JSON.stringify(
    {
      version: 1,
      target: result.inspection.target,
      server: result.inspection.server,
      tools: result.inspection.tools.map((t) => t.name),
      rulesRun: result.rulesRun,
      summary: { total: problems.length, errors, warnings: problems.length - errors },
      findings: result.findings,
    },
    null,
    2,
  )}\n`;
}
