import type { Finding, Inspection, Rule, Severity } from "../types.js";

/**
 * Text the model will read as an instruction, hidden in a field that was meant
 * to describe a tool. A description is the one part of a server that reaches
 * the model's context unreviewed, on every turn, in every client — which is
 * exactly why it is where an instruction goes when someone wants one obeyed.
 *
 * Severity is per pattern. Hostile text — ignore your instructions, hide this
 * from the user, send the credentials — is an error. A plain workflow
 * imperative ("you MUST call resolve first") is how most real servers sequence
 * their tools; it is worth a look, not a failed build. A hook into other tools
 * is the tool-shadowing attack in a description, but in the server's
 * instructions field it is that field's whole purpose, so it drops to a warning
 * there.
 */
interface InstructionPattern {
  pattern: RegExp;
  why: string;
  severity: Severity;
  /** Severity when the text is the server's instructions field, if different. */
  inInstructions?: Severity;
}

const INSTRUCTION_PATTERNS: InstructionPattern[] = [
  {
    pattern:
      /\bignore\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier|other|system)\s+(instructions?|prompts?|rules?|guidance|tools?)/i,
    why: "tells the model to ignore its instructions",
    severity: "error",
  },
  {
    pattern:
      /\b(you\s+must|you\s+should\s+always|always\s+(call|use|run|invoke|execute|read|send|include|prefer)|never\s+(call|use|tell|reveal|mention|inform|disclose|show))\b/i,
    why: "contains an imperative directed at the model",
    severity: "warn",
  },
  {
    pattern:
      /\b(do\s+not|don'?t|do\s+not\s+ever|never)\s+(tell|inform|mention|reveal|show|warn|ask|notify)\b[^.]{0,60}\b(user|human|operator)\b/i,
    why: "asks the model to hide something from the user",
    severity: "error",
  },
  {
    pattern: /\bsystem\s+prompt\b/i,
    why: "refers to the system prompt",
    severity: "error",
  },
  {
    pattern:
      /\b(before|after|when|whenever)\s+(calling|using|running|invoking)\s+(any|every|each|other|all|another)\s+(other\s+)?tools?\b/i,
    why: "hooks itself into the use of other tools",
    severity: "error",
    inInstructions: "warn",
  },
  {
    // The lookbehind keeps "do not include … credentials" — a server telling
    // the model NOT to send secrets — from reading as the opposite.
    pattern:
      /(?<!\b(?:not|never|don'?t|without|avoid|nor)\s+(?:\w+\s+){0,2})\b(send|forward|include|attach|pass|transmit|post)\b[^.]{0,60}\b(api[\s_-]?keys?|tokens?|passwords?|secrets?|credentials?|\.env|ssh[\s_-]?keys?|private[\s_-]?keys?)\b/i,
    why: "asks for credentials to be sent along",
    severity: "error",
  },
  {
    pattern: /<\s*(system|assistant|instruction|hidden)\b[^>]*>/i,
    why: "contains a fake role or instruction tag",
    severity: "error",
  },
];

/**
 * Characters that render as nothing and exist to hide text from a human reading
 * the description: zero-width spaces and joiners, bidi overrides, the BOM, and
 * the Unicode "tag" block.
 *
 * Built from numeric code points, deliberately. A raw U+2028 in this source is a
 * line terminator to the parser, and backslash-u escapes have been observed to
 * arrive decoded — so neither form is safe to keep in a regex literal.
 */
const cp = (n: number): string => String.fromCodePoint(n);
const span = (from: number, to: number): string => `${cp(from)}-${cp(to)}`;
const INVISIBLE = new RegExp(
  `[${span(0x200b, 0x200f)}${span(0x2028, 0x202e)}${span(0x2060, 0x2064)}${span(0x2066, 0x2069)}${cp(0xfeff)}]` +
    `|[${span(0xe0000, 0xe007f)}]`,
  "u",
);

const SECRET_PATTERNS: { pattern: RegExp; what: string }[] = [
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, what: "an AWS access key id" },
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/, what: "an sk- API key" },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, what: "a GitHub token" },
  { pattern: /\bxox[abp]-[A-Za-z0-9-]{10,}\b/, what: "a Slack token" },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: "a private key" },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/, what: "a bearer token" },
];

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "…" : ""}`;
}

function lintText(
  text: string,
  where: string,
  tool: string | undefined,
  findings: Finding[],
  isInstructions = false,
): void {
  for (const { pattern, why, severity, inInstructions } of INSTRUCTION_PATTERNS) {
    const m = pattern.exec(text);
    if (m) {
      findings.push({
        rule: descriptionLint.id,
        severity: isInstructions ? (inInstructions ?? severity) : severity,
        ...(tool ? { tool } : {}),
        message: `${where} ${why}`,
        detail: [`"${excerpt(text, m.index, m[0].length)}"`],
      });
    }
  }
  const inv = INVISIBLE.exec(text);
  if (inv) {
    const cp = inv[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
    findings.push({
      rule: descriptionLint.id,
      severity: "error",
      ...(tool ? { tool } : {}),
      message: `${where} contains an invisible character (U+${cp}) — text a human reviewer cannot see`,
      detail: [`at offset ${inv.index}`],
    });
  }
  for (const { pattern, what } of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      findings.push({
        rule: descriptionLint.id,
        severity: "error",
        ...(tool ? { tool } : {}),
        message: `${where} contains what looks like ${what}`,
        // Deliberately no excerpt: the finding must not repeat the secret.
      });
    }
  }
}

export const descriptionLint: Rule = {
  id: "description-lint",
  title: "Description reads as an instruction, hides text, or leaks a secret",
  description:
    "Tool descriptions and server instructions that direct the model, contain invisible characters, or include credentials. Hostile text is an error; a plain workflow imperative is a warning.",
  defaultSeverity: "error",
  check(inspection: Inspection): Finding[] {
    const findings: Finding[] = [];
    if (inspection.server.instructions) {
      lintText(
        inspection.server.instructions,
        "the server's instructions field",
        undefined,
        findings,
        true,
      );
    }
    for (const tool of inspection.tools) {
      if (tool.description) lintText(tool.description, "the description", tool.name, findings);
      if (tool.title) lintText(tool.title, "the title", tool.name, findings);
      // Property descriptions reach the model too.
      for (const [prop, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
        const d = (schema as { description?: unknown }).description;
        if (typeof d === "string")
          lintText(d, `the description of parameter "${prop}"`, tool.name, findings);
      }
    }
    return findings;
  },
};
