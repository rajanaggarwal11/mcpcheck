import { resolve } from "node:path";
import { inspect, parseTarget } from "./connect.js";
import type { ConnectOptions, Target } from "./connect.js";
import { ALL_RULES } from "./rules/index.js";
import type { CheckOptions, CheckResult, Finding, Inspection, Rule, RuleContext } from "./types.js";

export const DEFAULT_SNAPSHOT = "mcpcheck.snapshot.json";

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 } as const;

function select(rules: readonly Rule[], options: CheckOptions): Rule[] {
  const only = options.only?.length ? new Set(options.only) : undefined;
  const ignore = new Set(options.ignore ?? []);
  return rules.filter((r) => (!only || only.has(r.id)) && !ignore.has(r.id));
}

function order(findings: Finding[], ruleOrder: readonly string[]): Finding[] {
  return findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      ruleOrder.indexOf(a.rule) - ruleOrder.indexOf(b.rule) ||
      (a.tool ?? "").localeCompare(b.tool ?? ""),
  );
}

export interface CheckInput extends CheckOptions {
  /** Override the rule set. Defaults to every built-in rule. */
  rules?: readonly Rule[];
  /** Passed through to the transport. */
  connect?: ConnectOptions;
}

/** Runs every selected rule over an inspection you already have. Never connects. */
export async function checkInspection(
  inspection: Inspection,
  input: CheckInput = {},
): Promise<CheckResult> {
  const rules = select(input.rules ?? ALL_RULES, input);
  const context: RuleContext = {
    snapshotPath: resolve(input.snapshotPath ?? DEFAULT_SNAPSHOT),
    updateSnapshot: input.updateSnapshot ?? false,
  };
  const findings: Finding[] = [];
  for (const rule of rules) findings.push(...(await rule.check(inspection, context)));
  return {
    inspection,
    findings: order(
      findings,
      (input.rules ?? ALL_RULES).map((r) => r.id),
    ),
    rulesRun: rules.map((r) => r.id),
  };
}

/** Connects to a server, reads its tools, runs the rules, disconnects. */
export async function check(
  target: Target | readonly string[],
  input: CheckInput = {},
): Promise<CheckResult> {
  const t = Array.isArray(target) ? parseTarget(target as readonly string[]) : (target as Target);
  const inspection = await inspect(t, input.connect ?? {});
  return checkInspection(inspection, input);
}

export { inspect, parseTarget, describeTarget, connect } from "./connect.js";
export type { Target, ConnectOptions, Connection } from "./connect.js";
export { ALL_RULES, RULE_IDS, isRuleId } from "./rules/index.js";
export { snapshotOf, readSnapshot, writeSnapshot, diffSnapshots, canonical } from "./snapshot.js";
export type { Snapshot, SnapshotDiff, ToolChange } from "./snapshot.js";
export { formatReport, formatJson } from "./report.js";
export type {
  CheckOptions,
  CheckResult,
  Finding,
  Inspection,
  JsonSchema,
  Rule,
  RuleContext,
  RuleId,
  RuleMeta,
  ServerInfo,
  Severity,
  ToolAnnotations,
  ToolInfo,
} from "./types.js";
