import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonical, checkInspection, diffSnapshots, inspect, snapshotOf } from "../src/index.js";
import type { Snapshot, Target } from "../src/index.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const target = (name: string): Target => ({
  kind: "stdio",
  command: process.execPath,
  args: [fixture(name)],
});

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "mcpcheck-snap-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("canonical", () => {
  it("sorts keys at every depth and drops undefined, so equal content serialises equal", () => {
    expect(JSON.stringify(canonical({ b: 1, a: { d: undefined, c: [{ z: 1, y: 2 }] } }))).toBe(
      '{"a":{"c":[{"y":2,"z":1}]},"b":1}',
    );
  });
});

describe("diffSnapshots", () => {
  const base: Snapshot = {
    version: 1,
    server: { name: "s", version: "1.0.0" },
    tools: [
      {
        name: "a",
        description: "A",
        inputSchema: { type: "object", properties: { x: { type: "string" } } },
      },
      { name: "b", description: "B", inputSchema: { type: "object" } },
    ],
  };

  it("reports nothing for an identical snapshot, regardless of key order", () => {
    const reordered = JSON.parse(JSON.stringify(base)) as Snapshot;
    reordered.tools.reverse();
    expect(diffSnapshots(base, reordered).clean).toBe(true);
  });

  it("reports added, removed, and which fields changed", () => {
    const next: Snapshot = {
      version: 1,
      server: { name: "s", version: "1.1.0" },
      tools: [
        {
          name: "a",
          description: "A, now with details",
          inputSchema: { type: "object", properties: { x: { type: "number" } } },
        },
        { name: "c", inputSchema: { type: "object" } },
      ],
    };
    const d = diffSnapshots(base, next);
    expect(d.clean).toBe(false);
    expect(d.added).toEqual(["c"]);
    expect(d.removed).toEqual(["b"]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]?.name).toBe("a");
    expect(d.changed[0]?.fields).toEqual(["description", "inputSchema"]);
    expect(d.serverVersion).toEqual({ from: "1.0.0", to: "1.1.0" });
  });
});

describe("contract-drift, end to end", () => {
  it("writes the snapshot on first run, then guards it", async () => {
    const path = join(tmp, "invoices.json");
    const v1 = await inspect(target("drift-v1.mjs"));

    const first = await checkInspection(v1, { only: ["contract-drift"], snapshotPath: path });
    expect(first.findings).toHaveLength(1);
    expect(first.findings[0]?.severity).toBe("info");
    expect(first.findings[0]?.message).toContain("no snapshot yet");

    const written = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
    expect(written.version).toBe(1);
    expect(written.tools.map((t) => t.name)).toEqual([
      "get_invoice",
      "list_invoices",
      "send_invoice",
    ]);
    expect(JSON.stringify(written)).toBe(JSON.stringify(snapshotOf(v1)));

    // Same server again: nothing to say.
    const again = await checkInspection(v1, { only: ["contract-drift"], snapshotPath: path });
    expect(again.findings).toEqual([]);
  });

  it("turns the amount → amount_cents change into a red run with a readable diff", async () => {
    const path = join(tmp, "drift.json");
    await checkInspection(await inspect(target("drift-v1.mjs")), {
      only: ["contract-drift"],
      snapshotPath: path,
    });

    const r = await checkInspection(await inspect(target("drift-v2.mjs")), {
      only: ["contract-drift"],
      snapshotPath: path,
    });
    const errors = r.findings.filter((f) => f.severity === "error");
    const byTool = Object.fromEntries(errors.map((f) => [f.tool, f]));

    expect(byTool.list_invoices?.message).toContain("removed");
    expect(byTool.void_invoice?.message).toContain("added");
    expect(byTool.send_invoice?.message).toContain("inputSchema changed");
    expect(byTool.send_invoice?.detail?.join("\n")).toMatch(/amount.*amount_cents/s);
    expect(byTool.get_invoice?.message).toContain("description changed");
    expect(r.findings.find((f) => f.severity === "info")?.message).toContain("1.0.0 → 1.1.0");
  });

  it("--update accepts the live contract, and the next run is clean", async () => {
    const path = join(tmp, "update.json");
    await checkInspection(await inspect(target("drift-v1.mjs")), {
      only: ["contract-drift"],
      snapshotPath: path,
    });
    const v2 = await inspect(target("drift-v2.mjs"));

    const accepted = await checkInspection(v2, {
      only: ["contract-drift"],
      snapshotPath: path,
      updateSnapshot: true,
    });
    expect(accepted.findings.map((f) => f.severity)).toEqual(["info"]);
    expect(accepted.findings[0]?.message).toContain("snapshot written");

    const after = await checkInspection(v2, { only: ["contract-drift"], snapshotPath: path });
    expect(after.findings).toEqual([]);
  });

  it("refuses a file that is not a snapshot rather than diffing against garbage", async () => {
    const path = join(tmp, "garbage.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, '{"hello":"world"}');
    await expect(
      checkInspection(await inspect(target("drift-v1.mjs")), {
        only: ["contract-drift"],
        snapshotPath: path,
      }),
    ).rejects.toThrow(/not an mcpcheck snapshot/);
  });
});
