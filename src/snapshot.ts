import { readFile, writeFile } from "node:fs/promises";
import type { Inspection, ToolInfo } from "./types.js";

/**
 * The contract a server has committed to: every tool, exactly as advertised.
 * Sorted, canonicalised, and versioned, so a diff means the server changed and
 * not the serialiser.
 */
export interface Snapshot {
  version: 1;
  server: { name: string; version: string };
  tools: ToolInfo[];
}

/** JSON with keys sorted at every level — the same content always hashes and diffs the same. */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonical(v);
    }
    return out;
  }
  return value;
}

export function snapshotOf(inspection: Inspection): Snapshot {
  return canonical({
    version: 1,
    server: { name: inspection.server.name, version: inspection.server.version },
    tools: [...inspection.tools].sort((a, b) => a.name.localeCompare(b.name)),
  }) as Snapshot;
}

export async function readSnapshot(path: string): Promise<Snapshot | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed = JSON.parse(raw) as Partial<Snapshot>;
  if (parsed.version !== 1 || !Array.isArray(parsed.tools)) {
    throw new Error(`${path} is not an mcpcheck snapshot (expected version 1 with a tools array)`);
  }
  return parsed as Snapshot;
}

export async function writeSnapshot(path: string, snapshot: Snapshot): Promise<void> {
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export interface ToolChange {
  name: string;
  /** Which top-level fields differ. `description`, `inputSchema`, `annotations`, … */
  fields: string[];
  /** A short before/after for scalar fields, or "changed" for structures. */
  detail: string[];
}

export interface SnapshotDiff {
  added: string[];
  removed: string[];
  changed: ToolChange[];
  serverVersion?: { from: string; to: string };
  clean: boolean;
}

const short = (v: unknown): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s === undefined ? "∅" : s.length > 80 ? `${s.slice(0, 77)}…` : s;
};

/**
 * A schema diff a person can read: which properties came and went, which changed
 * type, and how `required` moved. Falls back to null when nothing at that level
 * differs (a nested change), so the caller prints the raw before/after instead.
 */
function describeSchemaChange(a: unknown, b: unknown): string | null {
  const pa = (a as { properties?: Record<string, { type?: unknown }> })?.properties ?? {};
  const pb = (b as { properties?: Record<string, { type?: unknown }> })?.properties ?? {};
  const ra = new Set((a as { required?: string[] })?.required ?? []);
  const rb = new Set((b as { required?: string[] })?.required ?? []);
  const parts: string[] = [];
  for (const k of Object.keys(pa)) if (!(k in pb)) parts.push(`property "${k}" removed`);
  for (const k of Object.keys(pb)) if (!(k in pa)) parts.push(`property "${k}" added`);
  for (const k of Object.keys(pa)) {
    if (k in pb && JSON.stringify(pa[k]?.type) !== JSON.stringify(pb[k]?.type)) {
      parts.push(
        `"${k}" type ${JSON.stringify(pa[k]?.type ?? null)} → ${JSON.stringify(pb[k]?.type ?? null)}`,
      );
    }
  }
  for (const k of ra) if (!rb.has(k)) parts.push(`"${k}" no longer required`);
  for (const k of rb) if (!ra.has(k)) parts.push(`"${k}" now required`);
  return parts.length ? parts.join("; ") : null;
}

/** What changed between the committed contract and the live server. */
export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const was = new Map(before.tools.map((t) => [t.name, t]));
  const now = new Map(after.tools.map((t) => [t.name, t]));

  const added = [...now.keys()].filter((n) => !was.has(n)).sort();
  const removed = [...was.keys()].filter((n) => !now.has(n)).sort();

  const changed: ToolChange[] = [];
  for (const [name, a] of was) {
    const b = now.get(name);
    if (!b) continue;
    const fields: string[] = [];
    const detail: string[] = [];
    for (const field of [
      "title",
      "description",
      "inputSchema",
      "outputSchema",
      "annotations",
    ] as const) {
      const x = JSON.stringify(canonical(a[field]));
      const y = JSON.stringify(canonical(b[field]));
      if (x !== y) {
        fields.push(field);
        const structural =
          field === "inputSchema" || field === "outputSchema"
            ? describeSchemaChange(a[field], b[field])
            : null;
        detail.push(
          structural
            ? `${field}: ${structural}`
            : `${field}: ${short(a[field])} → ${short(b[field])}`,
        );
      }
    }
    if (fields.length) changed.push({ name, fields, detail });
  }
  changed.sort((x, y) => x.name.localeCompare(y.name));

  const serverVersion =
    before.server.version !== after.server.version
      ? { from: before.server.version, to: after.server.version }
      : undefined;

  return {
    added,
    removed,
    changed,
    ...(serverVersion ? { serverVersion } : {}),
    clean: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}
