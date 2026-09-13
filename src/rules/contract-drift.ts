import { relative } from "node:path";
import { diffSnapshots, readSnapshot, snapshotOf, writeSnapshot } from "../snapshot.js";
import type { Finding, Inspection, Rule, RuleContext } from "../types.js";

/**
 * The server's tools, as committed, against the server's tools, as live.
 *
 * A schema that changed is a call the model now makes wrong. A description
 * that changed is an instruction the model now follows. Neither errors. This
 * rule turns both into a red CI run with a readable diff, and `--update` into
 * a deliberate, reviewable commit.
 */
export const contractDrift: Rule = {
  id: "contract-drift",
  title: "Live tools differ from the committed contract",
  description: "Tools added, removed, or changed since the snapshot was last accepted.",
  defaultSeverity: "error",
  async check(inspection: Inspection, context: RuleContext): Promise<Finding[]> {
    const live = snapshotOf(inspection);
    const file = relative(process.cwd(), context.snapshotPath) || context.snapshotPath;

    if (context.updateSnapshot) {
      await writeSnapshot(context.snapshotPath, live);
      return [
        {
          rule: contractDrift.id,
          severity: "info",
          message: `snapshot written to ${file} (${live.tools.length} tools)`,
        },
      ];
    }

    const committed = await readSnapshot(context.snapshotPath);
    if (!committed) {
      await writeSnapshot(context.snapshotPath, live);
      return [
        {
          rule: contractDrift.id,
          severity: "info",
          message: `no snapshot yet — wrote ${file} with ${live.tools.length} tools; commit it, and this rule starts guarding it`,
        },
      ];
    }

    const diff = diffSnapshots(committed, live);
    if (diff.clean) return [];

    const findings: Finding[] = [];
    for (const name of diff.removed) {
      findings.push({
        rule: contractDrift.id,
        severity: "error",
        tool: name,
        message: "removed — clients that call it now fail",
      });
    }
    for (const name of diff.added) {
      findings.push({
        rule: contractDrift.id,
        severity: "error",
        tool: name,
        message: "added since the snapshot — not yet reviewed",
      });
    }
    for (const c of diff.changed) {
      findings.push({
        rule: contractDrift.id,
        severity: "error",
        tool: c.name,
        message: `${c.fields.join(", ")} changed since the snapshot`,
        detail: [...c.detail, `accept with: mcpcheck … --update`],
      });
    }
    if (diff.serverVersion) {
      findings.push({
        rule: contractDrift.id,
        severity: "info",
        message: `server version ${diff.serverVersion.from} → ${diff.serverVersion.to}`,
      });
    }
    return findings;
  },
};
