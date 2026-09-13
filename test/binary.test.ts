import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The BUILT binary, through a symlink — the way npm installs a bin. A guard
 * that compares argv[1] to import.meta.url without realpath never fires through
 * one, and the CLI exits 0 having printed nothing. No server is needed here;
 * the point is only that the entry point runs at all when linked.
 */
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
let dir: string;
let linked: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mcpcheck-bin-"));
  linked = join(dir, "mcpcheck");
  symlinkSync(cli, linked);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(...args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [linked, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("the built binary, invoked through a symlink", () => {
  it("has been built", () => {
    expect(existsSync(cli), `${cli} missing — run pnpm build first`).toBe(true);
  });
  it("actually runs: --help prints usage and exits 0", () => {
    const r = run("--help");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("mcpcheck");
  });
  it("reports its version", () => {
    expect(run("--version").stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
  it("exits 2, not 0, when given nothing to do", () => {
    const r = run();
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("no server given");
  });
});
