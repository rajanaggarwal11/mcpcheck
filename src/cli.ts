#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pc from "picocolors";
import { check, DEFAULT_SNAPSHOT } from "./index.js";
import { parseTarget } from "./connect.js";
import { ALL_RULES, isRuleId } from "./rules/index.js";
import { formatJson, formatReport } from "./report.js";
import type { RuleId } from "./types.js";

/** 0 clean · 1 findings · 2 could not run. Documented, because CI depends on it. */
const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_ERROR = 2;

function version(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const HELP = `
${pc.bold("mcpcheck")} — correctness checks for MCP servers

${pc.bold("Usage")}
  mcpcheck [options] <url>               Streamable HTTP server
  mcpcheck [options] <command> [args…]   stdio server: the command that starts it
  mcpcheck npx -y @scope/some-server     works for anything on npm

  mcpcheck's options go before the server. From the command on, every argument
  is passed to the server as is, flags included. -- also ends mcpcheck's options.

${pc.bold("Options")}
  --snapshot <file>    Contract snapshot path (default: ${DEFAULT_SNAPSHOT})
  --update             Accept the live tools as the new contract
  --only <ids>         Run only these rules (comma-separated)
  --ignore <ids>       Skip these rules (comma-separated)
  --strict             Exit non-zero on warnings too, not just errors
  --json               Machine-readable output (stable shape, version 1)
  --timeout <time>     Handshake timeout: 15000, 1500ms, 30s (default 15s)
  --list-rules         Print every rule and what it checks
  --no-color, --color  Turn colour off, or force it on
  -v, --version        Print the version
  -h, --help           Print this

${pc.bold("Exit codes")}
  0  nothing to report
  1  findings remain (errors, or any finding under --strict)
  2  could not run — no server, handshake failed, bad option

${pc.bold("What it never does")}
  Call a tool. Every check reads what the server advertises; nothing is invoked.

${pc.bold("Examples")}
  mcpcheck node ./dist/server.js
  mcpcheck npx -y @modelcontextprotocol/server-filesystem /tmp
  mcpcheck http://localhost:3000/mcp --json
  mcpcheck --update node ./server.js      # after a deliberate tool change
  mcpcheck --json node ./server.js --port 0
`;

function listRules(): string {
  const w = Math.max(...ALL_RULES.map((r) => r.id.length));
  return `\n${pc.bold("Rules")}\n${ALL_RULES.map((r) => {
    const tag =
      r.defaultSeverity === "error"
        ? pc.red("error")
        : r.defaultSeverity === "warn"
          ? pc.yellow("warn ")
          : pc.cyan("info ");
    return `  ${pc.bold(r.id.padEnd(w))}  ${tag}  ${r.description}`;
  }).join("\n")}\n`;
}

function ruleList(value: string | undefined, flag: string): RuleId[] {
  if (!value) return [];
  const ids = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = ids.filter((id) => !isRuleId(id));
  if (bad.length)
    throw new Error(
      `unknown rule${bad.length > 1 ? "s" : ""} for ${flag}: ${bad.join(", ")} — see --list-rules`,
    );
  return ids as RuleId[];
}

/** Milliseconds from "15000", "1500ms" or "30s" (decimals allowed); NaN for anything else. */
export function parseDuration(text: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s)?$/i.exec(text.trim());
  if (!m) return Number.NaN;
  const n = Number(m[1]);
  return Math.round(m[2]?.toLowerCase() === "s" ? n * 1000 : n);
}

const OPTIONS = {
  snapshot: { type: "string" },
  update: { type: "boolean", default: false },
  only: { type: "string" },
  ignore: { type: "string" },
  strict: { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  timeout: { type: "string" },
  "list-rules": { type: "boolean", default: false },
  version: { type: "boolean", short: "v", default: false },
  help: { type: "boolean", short: "h", default: false },
  // Read by picocolors straight from process.argv; declared so they are accepted.
  color: { type: "boolean", default: false },
  "no-color": { type: "boolean", default: false },
} as const;

const OWN_FLAGS = new Set(Object.keys(OPTIONS).map((name) => `--${name}`));
const SHORT_FLAGS = new Set<string>(
  Object.values(OPTIONS).flatMap((o) => ("short" in o ? [o.short] : [])),
);
const TAKES_VALUE = new Set(
  Object.entries(OPTIONS)
    .filter(([, o]) => o.type === "string")
    .map(([name]) => `--${name}`),
);

export interface SplitArgv {
  /** mcpcheck's own options, ready for parseArgs. */
  own: string[];
  /** The server: a URL, or a command line passed through verbatim. */
  server: string[];
  /** True when the server's command line came after an explicit `--`. */
  separated: boolean;
}

/**
 * Splits argv at the server's command line. mcpcheck's options come first; the
 * first positional starts the server's command, and everything from there on is
 * the server's, verbatim: `mcpcheck npx -y @scope/server ./data` must hand `-y`
 * to npx, not read it as an option of ours. `--` ends our options explicitly.
 * An HTTP URL takes no arguments, so options after one are still ours.
 */
export function splitArgv(argv: readonly string[]): SplitArgv {
  const own: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") return { own, server: argv.slice(i + 1), separated: true };
    if (arg.startsWith("--")) {
      const name = arg.split("=", 1)[0]!;
      if (!OWN_FLAGS.has(name))
        throw new Error(
          `unknown option ${name}. mcpcheck's options go before the server's command; ` +
            `anything after the command, or after --, is passed to the server.`,
        );
      own.push(arg);
      if (TAKES_VALUE.has(name) && !arg.includes("=")) {
        const value = argv[i + 1];
        if (value === undefined || value === "--") throw new Error(`${name} needs a value`);
        own.push(value);
        i++;
      }
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      const unknown = [...arg.slice(1)].find((c) => !SHORT_FLAGS.has(c));
      if (unknown)
        throw new Error(
          `unknown option -${unknown}. mcpcheck's options go before the server's command; ` +
            `anything after the command, or after --, is passed to the server.`,
        );
      own.push(arg);
      continue;
    }
    if (/^https?:\/\//i.test(arg)) {
      const rest = splitArgv(argv.slice(i + 1));
      return { own: [...own, ...rest.own], server: [arg, ...rest.server], separated: false };
    }
    return { own, server: argv.slice(i), separated: false };
  }
  return { own, server: [], separated: false };
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
  let values: Record<string, unknown>;
  let positionals: string[];
  let separated: boolean;
  try {
    const split = splitArgv(argv);
    ({ values } = parseArgs({
      args: split.own,
      options: OPTIONS,
      allowPositionals: false,
      strict: true,
    }));
    positionals = split.server;
    separated = split.separated;
  } catch (error) {
    process.stderr.write(`${pc.red("✗")} ${(error as Error).message}\n${HELP}`);
    return EXIT_ERROR;
  }

  if (values.help) return (process.stdout.write(HELP), EXIT_OK);
  if (values.version) return (process.stdout.write(`${version()}\n`), EXIT_OK);
  if (values["list-rules"]) return (process.stdout.write(listRules()), EXIT_OK);

  const asJson = Boolean(values.json);
  // Options after the command used to be read as mcpcheck's own. Say so when one
  // looks like it was meant that way, rather than let it change nothing silently.
  if (!separated && positionals.length > 1 && !/^https?:\/\//i.test(positionals[0]!)) {
    const ours = positionals.slice(1).filter((a) => OWN_FLAGS.has(a.split("=", 1)[0]!));
    if (ours.length)
      process.stderr.write(
        `${pc.yellow("!")} ${ours.join(", ")} came after the server command, so ${ours.length > 1 ? "they were" : "it was"} passed to the server. ` +
          `Put mcpcheck's options before the command, or use -- to silence this.\n`,
      );
  }
  try {
    const target = parseTarget(positionals);
    const timeoutMs = values.timeout ? parseDuration(String(values.timeout)) : undefined;
    if (timeoutMs !== undefined && !(timeoutMs > 0))
      throw new Error(
        `--timeout expects a duration like 15000, 1500ms or 30s, got "${values.timeout}"`,
      );

    const result = await check(target, {
      only: ruleList(values.only as string | undefined, "--only"),
      ignore: ruleList(values.ignore as string | undefined, "--ignore"),
      snapshotPath: values.snapshot as string | undefined,
      updateSnapshot: Boolean(values.update),
      connect: timeoutMs ? { timeoutMs } : {},
    });

    process.stdout.write(asJson ? formatJson(result) : formatReport(result));

    const problems = result.findings.filter((f) => f.severity !== "info");
    const blocking = values.strict
      ? problems.length
      : problems.filter((f) => f.severity === "error").length;
    return blocking > 0 ? EXIT_FINDINGS : EXIT_OK;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${pc.red("✗")} ${reason}\n`);
    return EXIT_ERROR;
  }
}

/** realpath on both sides: npm installs a bin as a symlink, and a raw compare never fires through one. */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  run().then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`✗ ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(EXIT_ERROR);
    },
  );
}
