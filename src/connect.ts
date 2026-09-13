import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Readable } from "node:stream";
import type { Inspection, JsonSchema, ToolAnnotations, ToolInfo } from "./types.js";

/**
 * How to reach a server. Two shapes, decided by the first argument:
 *
 *   mcpcheck http://localhost:3000/mcp        → Streamable HTTP
 *   mcpcheck node ./server.js                 → stdio: spawn the command
 *   mcpcheck npx -y @scope/some-mcp-server    → stdio: spawn the command
 */
export type Target =
  { kind: "http"; url: string } | { kind: "stdio"; command: string; args: string[] };

export function parseTarget(argv: readonly string[]): Target {
  const [first, ...rest] = argv;
  if (!first)
    throw new Error("no server given. Pass a URL, or the command that starts the server.");
  if (/^https?:\/\//i.test(first)) {
    if (rest.length) throw new Error("an HTTP target takes no further arguments.");
    return { kind: "http", url: first };
  }
  return { kind: "stdio", command: first, args: rest };
}

/** The target as it may be printed: the URL without credentials, or the command line. */
export function describeTarget(target: Target): string {
  if (target.kind === "http") {
    try {
      const u = new URL(target.url);
      if (u.password) u.password = "***";
      return u.toString();
    } catch {
      return "<url>";
    }
  }
  return [target.command, ...target.args].join(" ");
}

/** Whatever the server wrote to stderr so far — buffered, since nothing consumed it. */
function stderrTail(transport: StdioClientTransport): string {
  // The SDK types this as a bare Stream; at runtime it is the child's stderr Readable.
  const stream = transport.stderr as Readable | null;
  const buffered = stream?.read() as Buffer | string | null | undefined;
  if (!buffered) return "";
  const lines = String(buffered).trim().split("\n").filter(Boolean);
  // The first lines, not the last: a crash puts its message at the top and the stack below.
  return lines.slice(0, 5).join("\n  ");
}

export interface Connection {
  client: Client;
  close(): Promise<void>;
}

export interface ConnectOptions {
  /** Milliseconds to wait for the initialize handshake. Default 15 s. */
  timeoutMs?: number;
  /** Environment for a spawned server. Defaults to the SDK's safe subset of process.env. */
  env?: Record<string, string>;
}

export async function connect(target: Target, options: ConnectOptions = {}): Promise<Connection> {
  const client = new Client({ name: "mcpcheck", version: "0.1.0" });
  const transport =
    target.kind === "http"
      ? new StreamableHTTPClientTransport(new URL(target.url))
      : new StdioClientTransport({
          command: target.command,
          args: target.args,
          ...(options.env ? { env: options.env } : {}),
          // Piped, not ignored: when a server dies during the handshake, its
          // last words are the only diagnosis there is. It is never printed
          // otherwise.
          stderr: "pipe",
        });

  const timeoutMs = options.timeoutMs ?? 15_000;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`the server did not complete the MCP handshake within ${timeoutMs / 1000}s`),
        ),
      timeoutMs,
    );
  });

  try {
    await Promise.race([client.connect(transport), timeout]);
  } catch (error) {
    let reason = error instanceof Error ? error.message : String(error);
    if (/connection closed/i.test(reason)) {
      reason = "the server ended the connection before completing the MCP handshake (did it exit?)";
    }
    const tail = target.kind === "stdio" ? stderrTail(transport as StdioClientTransport) : "";
    await transport.close().catch(() => {});
    throw new Error(tail ? `${reason}\n  server stderr: ${tail}` : reason, { cause: error });
  } finally {
    if (timer) clearTimeout(timer);
  }

  return {
    client,
    close: async () => {
      await client.close().catch(() => {});
    },
  };
}

/** Reads everything a rule may look at. One list call; no tool is ever invoked here. */
export async function inspect(target: Target, options: ConnectOptions = {}): Promise<Inspection> {
  const conn = await connect(target, options);
  try {
    const version = conn.client.getServerVersion();
    const instructions = conn.client.getInstructions();

    const tools: ToolInfo[] = [];
    let cursor: string | undefined;
    do {
      let page;
      try {
        page = await conn.client.listTools(cursor ? { cursor } : undefined);
      } catch (error) {
        // The SDK validates tools/list against the protocol schema before we ever
        // see it. A server that fails here is broken for EVERY SDK-based client —
        // one malformed tool takes the whole list down — which is worth saying
        // plainly rather than surfacing a validation stack.
        const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
        throw new Error(
          `the server's tools/list response is not valid MCP, so no SDK client can list its tools: ${reason}`,
          { cause: error },
        );
      }
      for (const t of page.tools) {
        tools.push({
          name: t.name,
          ...(t.title ? { title: t.title } : {}),
          ...(t.description ? { description: t.description } : {}),
          inputSchema: t.inputSchema as JsonSchema,
          ...(t.outputSchema ? { outputSchema: t.outputSchema as JsonSchema } : {}),
          ...(t.annotations ? { annotations: t.annotations as ToolAnnotations } : {}),
        });
      }
      cursor = page.nextCursor;
    } while (cursor);

    tools.sort((a, b) => a.name.localeCompare(b.name));

    return {
      target: describeTarget(target),
      server: {
        name: version?.name ?? "unknown",
        version: version?.version ?? "unknown",
        ...(instructions ? { instructions } : {}),
      },
      tools,
    };
  } finally {
    await conn.close();
  }
}
