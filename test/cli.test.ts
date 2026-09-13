import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";

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
    process.execPath,
    fixture(name),
    "--snapshot",
    join(tmp, `${name}-${extra.join("").replace(/\W/g, "")}.json`),
    ...extra,
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

  it("exits 2 when the command is not an MCP server", async () => {
    // A process that exits immediately never completes the handshake.
    const r = await cli(process.execPath, "-e", "process.exit(0)", "--timeout", "3000");
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
      process.execPath,
      fixture("drift-v1.mjs"),
      "--snapshot",
      snap,
      "--only",
      "contract-drift",
    );
    expect(v1.code).toBe(0);
    expect(v1.stdout).toContain("no snapshot yet");

    const drifted = await cli(
      process.execPath,
      fixture("drift-v2.mjs"),
      "--snapshot",
      snap,
      "--only",
      "contract-drift",
    );
    expect(drifted.code).toBe(1);
    expect(drifted.stdout).toContain("send_invoice");
    expect(drifted.stdout).toContain("--update");

    const accepted = await cli(
      process.execPath,
      fixture("drift-v2.mjs"),
      "--snapshot",
      snap,
      "--only",
      "contract-drift",
      "--update",
    );
    expect(accepted.code).toBe(0);

    const after = await cli(
      process.execPath,
      fixture("drift-v2.mjs"),
      "--snapshot",
      snap,
      "--only",
      "contract-drift",
    );
    expect(after.code).toBe(0);
    expect(after.stdout).toContain("No problems found");
  });
});
