import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseDuration, run, splitArgv } from "../src/cli.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "mcpcheck-cli-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

async function cli(...args: string[]): Promise<Captured> {
  let stdout = "";
  let stderr = "";
  const out = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((c) => ((stdout += String(c)), true));
  const err = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((c) => ((stderr += String(c)), true));
  try {
    return { code: await run(args), stdout, stderr };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

/** A fixture server, with its own snapshot file so tests never share state. */
const against = (name: string, ...extra: string[]) =>
  cli(
    "--snapshot",
    join(tmp, `${name}-${extra.join("").replace(/\W/g, "")}.json`),
    ...extra,
    process.execPath,
    fixture(name),
  );

describe("usage", () => {
  it("--help documents the exit codes and the promise never to call a tool", async () => {
    const r = await cli("--help");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Exit codes");
    expect(r.stdout).toContain("Call a tool");
  });

  it("--version prints a version", async () => {
    expect((await cli("--version")).stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("--list-rules names every rule", async () => {
    const r = await cli("--list-rules");
    expect(r.code).toBe(0);
    for (const id of [
      "contract-drift",
      "description-lint",
      "annotation-honesty",
      "schema-validity",
    ]) {
      expect(r.stdout).toContain(id);
    }
  });

  it("exits 2 with no server given", async () => {
    const r = await cli();
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no server given");
  });

  it("exits 2 on an unknown rule id", async () => {
    const r = await against("clean.mjs", "--only", "no-such-rule");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown rule");
  });

  it("passes the server's own flags through after --, and shows its stderr when it dies", async () => {
    const r = await cli(
      "--timeout",
      "5000",
      "--",
      process.execPath,
      "-e",
      'process.stderr.write("fatal: config missing\\n"); process.exit(3)',
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("before completing the MCP handshake");
    expect(r.stderr).toContain("fatal: config missing");
  });

  it("--timeout takes milliseconds or a unit, and refuses anything else with an example", async () => {
    expect(parseDuration("15000")).toBe(15000);
    expect(parseDuration("1500ms")).toBe(1500);
    expect(parseDuration("30s")).toBe(30000);
    expect(parseDuration("2.5s")).toBe(2500);
    expect(parseDuration("5m")).toBeNaN();
    const r = await cli("--timeout", "soon", "--", process.execPath, "-e", "process.exit(0)");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('like 15000, 1500ms or 30s, got "soon"');
  });

  it("exits 2 when the command is not an MCP server", async () => {
    // A process that exits immediately never completes the handshake.
    const r = await cli("--timeout", "3000", process.execPath, "-e", "process.exit(0)");
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/✗/);
  });
});

describe("exit codes against real servers", () => {
  it("0 on a clean server", async () => {
    const r = await against("clean.mjs");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("No problems found");
    expect(r.stdout).toContain("clean-server 1.0.0");
  });

  it("1 when a description carries an instruction", async () => {
    const r = await against("injected.mjs");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("description-lint");
    expect(r.stdout).toContain("search_docs");
  });

  it("0 for warnings alone, 1 for the same run under --strict", async () => {
    // dishonest.mjs's `ping` only trips missing-annotations, a warning.
    const warnOnly = ["--only", "missing-annotations"];
    expect((await against("dishonest.mjs", ...warnOnly)).code).toBe(0);
    expect((await against("dishonest.mjs", ...warnOnly, "--strict")).code).toBe(1);
  });

  it("--json emits the documented shape", async () => {
    const r = await against("injected.mjs", "--json");
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout) as {
      version: number;
      server: { name: string; instructions?: string };
      tools: string[];
      summary: { total: number; errors: number; warnings: number };
      findings: { rule: string; severity: string }[];
    };
    expect(report.version).toBe(1);
    expect(report.server.name).toBe("injected-server");
    expect(report.tools).toEqual(["export_report", "search_docs", "summarize"]);
    expect(report.summary.total).toBe(report.findings.filter((f) => f.severity !== "info").length);
    expect(report.summary.errors).toBeGreaterThan(0);
  });
});

describe("--update", () => {
  it("accepts a drifted contract and the next run passes", async () => {
    const snap = join(tmp, "flow.json");
    const v1 = await cli(
      "--snapshot",
      snap,
      "--only",
      "contract-drift",
      process.execPath,
      fixture("drift-v1.mjs"),
    );
    expect(v1.code).toBe(0);
    expect(v1.stdout).toContain("no snapshot yet");

    const drifted = await cli(
      "--snapshot",
      snap,
      "--only",
      "contract-drift",
      process.execPath,
      fixture("drift-v2.mjs"),
    );
    expect(drifted.code).toBe(1);
    expect(drifted.stdout).toContain("send_invoice");
    expect(drifted.stdout).toContain("--update");

    const accepted = await cli(
      "--snapshot",
      snap,
      "--only",
      "contract-drift",
      "--update",
      process.execPath,
      fixture("drift-v2.mjs"),
    );
    expect(accepted.code).toBe(0);

    const after = await cli(
      "--snapshot",
      snap,
      "--only",
      "contract-drift",
      process.execPath,
      fixture("drift-v2.mjs"),
    );
    expect(after.code).toBe(0);
    expect(after.stdout).toContain("No problems found");
  });
});

describe("the server's command line", () => {
  /** The arguments echo-argv.mjs received, read back from its instructions field. */
  const serverArgv = (stdout: string) =>
    JSON.parse((JSON.parse(stdout) as { server: { instructions: string } }).server.instructions);

  it("passes every argument from the command on to the server, -y and other flags included", async () => {
    const snap = join(tmp, "argv.json");
    const r = await cli(
      "--json",
      "--snapshot",
      snap,
      process.execPath,
      fixture("echo-argv.mjs"),
      "-y",
      "--port",
      "0",
      "-v",
      "--",
      "./data",
    );
    expect(r.code).toBe(0);
    expect(serverArgv(r.stdout)).toEqual(["-y", "--port", "0", "-v", "--", "./data"]);
    expect(r.stderr).toBe("");
  });

  it("hands an mcpcheck option after the command to the server, and says so", async () => {
    const snap = join(tmp, "argv-late.json");
    const r = await cli("--snapshot", snap, process.execPath, fixture("echo-argv.mjs"), "--json");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("argv-server");
    expect(r.stderr).toContain("--json came after the server command");
  });

  it("stays quiet about server flags that follow an explicit --", async () => {
    const snap = join(tmp, "argv-sep.json");
    const r = await cli(
      "--json",
      "--snapshot",
      snap,
      "--",
      process.execPath,
      fixture("echo-argv.mjs"),
      "--json",
    );
    expect(r.code).toBe(0);
    expect(serverArgv(r.stdout)).toEqual(["--json"]);
    expect(r.stderr).toBe("");
  });

  it("splits at the first positional, minding options that take a value", () => {
    expect(splitArgv(["npx", "-y", "@modelcontextprotocol/server-filesystem", "./data"])).toEqual({
      own: [],
      server: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "./data"],
      separated: false,
    });
    expect(
      splitArgv(["--timeout", "5000", "--strict", "--only=contract-drift", "npx", "-y", "pkg"]),
    ).toEqual({
      own: ["--timeout", "5000", "--strict", "--only=contract-drift"],
      server: ["npx", "-y", "pkg"],
      separated: false,
    });
    expect(splitArgv(["--json", "--", "node", "s.js", "--json"])).toEqual({
      own: ["--json"],
      server: ["node", "s.js", "--json"],
      separated: true,
    });
  });

  it("still reads options after a URL, which takes no arguments of its own", () => {
    expect(splitArgv(["http://localhost:3000/mcp", "--json", "--timeout", "30s"])).toEqual({
      own: ["--json", "--timeout", "30s"],
      server: ["http://localhost:3000/mcp"],
      separated: false,
    });
  });

  it("refuses an unknown option before the command, and says where server flags go", async () => {
    for (const bad of ["--port", "-y"]) {
      const r = await cli(bad, "0", "node", "./server.js");
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(`unknown option ${bad}`);
      expect(r.stderr).toContain("passed to the server");
    }
  });

  it("reads mcpcheck's own options before the command", async () => {
    const r = await cli("--timeout", "soon", "node", "./server.js");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('got "soon"');
  });

  it("accepts --no-color and --color before the command", async () => {
    for (const flag of ["--no-color", "--color"]) {
      const r = await cli(flag, "--list-rules");
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("contract-drift");
    }
    expect(splitArgv(["--no-color", "node", "s.js"])).toEqual({
      own: ["--no-color"],
      server: ["node", "s.js"],
      separated: false,
    });
  });

  it("says an option that takes a value needs one, rather than take -- or the end", async () => {
    for (const argv of [
      ["--snapshot", "--", "node", "s.js"],
      ["--snapshot"],
      ["--json", "--timeout"],
    ]) {
      const r = await cli(...argv);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/--(snapshot|timeout) needs a value/);
    }
  });
});
