import { annotationHonesty } from "./annotation-honesty.js";
import { contractDrift } from "./contract-drift.js";
import { descriptionLint } from "./description-lint.js";
import { missingAnnotations } from "./missing-annotations.js";
import { overBroadTool } from "./over-broad-tool.js";
import { schemaValidity } from "./schema-validity.js";
import type { Rule, RuleId } from "../types.js";

/** Every rule, in the order the report reads: what the model will obey first, hygiene last. */
export const ALL_RULES: readonly Rule[] = [
  descriptionLint,
  overBroadTool,
  contractDrift,
  annotationHonesty,
  schemaValidity,
  missingAnnotations,
];
export const RULE_IDS: readonly RuleId[] = ALL_RULES.map((r) => r.id);
export const isRuleId = (v: string): v is RuleId => (RULE_IDS as readonly string[]).includes(v);
export {
  annotationHonesty,
  contractDrift,
  descriptionLint,
  missingAnnotations,
  overBroadTool,
  schemaValidity,
};
