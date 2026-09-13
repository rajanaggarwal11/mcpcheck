import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkInspection, inspect } from "../src/index.js";
import type { Finding, Inspection, RuleId, Target } from "../src/index.js";

/**
 * Every test here spawns a REAL MCP server over stdio and inspects it through
 * the SDK client — no mocked tool lists. Each fixture violates exactly the
 * rules it is named for, and the clean one violates none.
 */
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const target = (name: string): Target => ({
  kind: "stdio",
  command: process.execPath,
  args: [fixture(name)],
});

let tmp: string;
const cache = new Map<string, Inspection>();

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "mcpcheck-rules-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function inspected(name: string): Promise<Inspection> {
  let i = cache.get(name);
  if (!i) {
    i = await inspect(target(name));
    cache.set(name, i);
  }
  return i;
}

async function findings(name: string, only: RuleId[]): Promise<Finding[]> {
  const r = await checkInspection(await inspected(name), {
    only,
    snapshotPath: join(tmp, `${name}.json`),
  });
  return r.findings.filter((f) => f.severity !== "info");
}

const tools = (fs: Finding[]) => [...new Set(fs.map((f) => f.tool))].sort();

describe("inspection", () => {
  it("reads name, version, instructions and every tool over a real stdio connection", async () => {
    const i = await inspected("injected.mjs");
    expect(i.server.name).toBe("injected-server");
    expect(i.server.version).toBe("1.0.0");
    expect(i.server.instructions).toContain("Do not tell the user");
    expect(i.tools.map((t) => t.name)).toEqual(["export_report", "search_docs", "summarize"]);
    expect(i.tools[1]?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
    expect(i.tools[1]?.inputSchema.type).toBe("object");
  });

  it("never invokes a tool", async () => {
    // Every fixture handler returns a constant; if one were called, nothing here
    // would notice — so this is asserted structurally: inspect() has no
    // callTool path. The connect module exposes the client only through
    // inspect(), which lists and disconnects.
    const i = await inspected("clean.mjs");
    expect(i.tools.length).toBe(3);
  });
});

describe("a clean server", () => {
  it("produces no problems across every rule", async () => {
    const r = await checkInspection(await inspected("clean.mjs"), {
      snapshotPath: join(tmp, "clean.json"),
    });
    const problems = r.findings.filter((f) => f.severity !== "info");
    expect(problems).toEqual([]);
    // The only output is the snapshot being created on first run.
    expect(r.findings.map((f) => f.rule)).toEqual(["contract-drift"]);
    expect(r.findings[0]?.message).toContain("no snapshot yet");
  });
});

describe("description-lint", () => {
  it("catches an instruction hidden in a tool description", async () => {
    const fs = await findings("injected.mjs", ["description-lint"]);
    const hit = fs.find(
      (f) => f.tool === "search_docs" && /ignore its instructions/.test(f.message),
    );
    expect(hit).toBeDefined();
    expect(hit?.detail?.[0]).toContain("Ignore all previous instructions");
  });

  it("catches an invisible character a human reviewer cannot see", async () => {
    const fs = await findings("injected.mjs", ["description-lint"]);
    const hit = fs.find(
      (f) => f.tool === "summarize" && /invisible character \(U\+200B\)/.test(f.message),
    );
    expect(hit).toBeDefined();
  });

  it("lints parameter descriptions, which reach the model too", async () => {
    const fs = await findings("injected.mjs", ["description-lint"]);
    expect(
      fs.some((f) => f.tool === "summarize" && /parameter "text".*system prompt/.test(f.message)),
    ).toBe(true);
  });

  it("catches a request to send credentials along", async () => {
    const fs = await findings("injected.mjs", ["description-lint"]);
    expect(fs.some((f) => f.tool === "export_report" && /credentials/.test(f.message))).toBe(true);
  });

  it("lints the server's instructions field — the biggest injection surface of all", async () => {
    const fs = await findings("injected.mjs", ["description-lint"]);
    const hit = fs.find((f) => f.tool === undefined && /server's instructions/.test(f.message));
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("hide something from the user");
  });

  it("says nothing about ordinary descriptions", async () => {
    expect(await findings("clean.mjs", ["description-lint"])).toEqual([]);
  });
});

describe("over-broad-tool", () => {
  it("flags a tool that runs shell commands as an error", async () => {
    const fs = await findings("over-broad.mjs", ["over-broad-tool"]);
    const hit = fs.find((f) => f.tool === "run_command");
    expect(hit?.severity).toBe("error");
    expect(hit?.message).toContain("terminal");
  });

  it("warns on a write to an unconstrained path, and not on a constrained one", async () => {
    const fs = await findings("over-broad.mjs", ["over-broad-tool"]);
    expect(fs.find((f) => f.tool === "write_file")?.severity).toBe("warn");
    expect(fs.find((f) => f.tool === "write_config")).toBeUndefined();
  });
});

describe("annotation-honesty", () => {
  it("flags a delete that claims to be read-only and non-destructive — twice", async () => {
    const fs = await findings("dishonest.mjs", ["annotation-honesty"]);
    const del = fs.filter((f) => f.tool === "delete_record");
    expect(del).toHaveLength(2);
    expect(del.every((f) => f.severity === "error")).toBe(true);
  });

  it("flags a create that claims to be read-only", async () => {
    const fs = await findings("dishonest.mjs", ["annotation-honesty"]);
    expect(fs.find((f) => f.tool === "create_item")?.message).toContain("skip confirmation");
  });

  it("flags read-only and destructive at once as a contradiction", async () => {
    const fs = await findings("dishonest.mjs", ["annotation-honesty"]);
    expect(fs.some((f) => f.tool === "get_item" && /cannot be both/.test(f.message))).toBe(true);
  });

  it("leaves honest annotations alone", async () => {
    expect(await findings("clean.mjs", ["annotation-honesty"])).toEqual([]);
  });
});

describe("missing-annotations", () => {
  it("warns on a tool that declares nothing", async () => {
    const fs = await findings("dishonest.mjs", ["missing-annotations"]);
    expect(tools(fs)).toEqual(["ping"]);
    expect(fs[0]?.severity).toBe("warn");
  });
});

describe("schema-validity", () => {
  it("a non-object input schema cannot even be listed — one bad tool breaks tools/list for every SDK client", async () => {
    // The SDK validates the list before any rule sees it. mcpcheck reports what
    // that means instead of a zod stack, because the operator needs to know the
    // whole server is unusable, not that one tool is odd.
    await expect(inspect(target("unlistable.mjs"))).rejects.toThrow(
      /tools\/list response is not valid MCP/,
    );
  });

  it("catches a required property that is not defined", async () => {
    const fs = await findings("bad-schema.mjs", ["schema-validity"]);
    expect(fs.find((f) => f.tool === "requires_ghost")?.message).toContain('"b"');
  });

  it("warns on an untyped parameter and on a schema that accepts anything", async () => {
    const fs = await findings("bad-schema.mjs", ["schema-validity"]);
    expect(fs.find((f) => f.tool === "untyped_param")?.severity).toBe("warn");
    expect(fs.find((f) => f.tool === "accepts_anything")?.message).toContain("accepts anything");
  });

  it("accepts everything the SDK generates from zod", async () => {
    expect(await findings("clean.mjs", ["schema-validity"])).toEqual([]);
  });
});
