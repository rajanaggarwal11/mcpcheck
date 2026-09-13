/** A JSON Schema as MCP carries it: loosely typed on purpose, we only inspect it. */
export type JsonSchema = Record<string, unknown> & {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
};

/** The four behavioural hints a tool may declare. Clients use them to decide when to ask the human. */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** One tool as the server advertises it — everything the AI client gets to know. */
export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
}

export interface ServerInfo {
  name: string;
  version: string;
  /** Free text the server asks the client to put in the model's context. An injection surface. */
  instructions?: string;
  protocolVersion?: string;
}

/** Everything mcpcheck learned from one connection. Rules read this and nothing else. */
export interface Inspection {
  /** How the server was reached, for messages. Never contains credentials. */
  target: string;
  server: ServerInfo;
  tools: ToolInfo[];
}

export type RuleId =
  | "contract-drift"
  | "description-lint"
  | "over-broad-tool"
  | "annotation-honesty"
  | "missing-annotations"
  | "schema-validity";

export type Severity = "error" | "warn" | "info";

export interface Finding {
  rule: RuleId;
  severity: Severity;
  /** The tool the finding is about, or absent for server-level findings. */
  tool?: string;
  /** One line, stated as the problem — not as advice. */
  message: string;
  /** Extra lines printed underneath: the offending text, the diff, the field. */
  detail?: string[];
}

export interface RuleContext {
  /** Absolute path of the contract snapshot file. */
  snapshotPath: string;
  /** Rewrite the snapshot instead of diffing against it. */
  updateSnapshot: boolean;
}

export interface RuleMeta {
  id: RuleId;
  title: string;
  /** One sentence, shown by --list-rules and in the README table. */
  description: string;
  defaultSeverity: Severity;
}

export interface Rule extends RuleMeta {
  check(inspection: Inspection, context: RuleContext): Finding[] | Promise<Finding[]>;
}

export interface CheckOptions {
  only?: RuleId[];
  ignore?: RuleId[];
  snapshotPath?: string;
  updateSnapshot?: boolean;
}

export interface CheckResult {
  inspection: Inspection;
  findings: Finding[];
  rulesRun: RuleId[];
}
