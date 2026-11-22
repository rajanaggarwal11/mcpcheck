# mcpcheck

## 0.2.0

### Minor Changes

- [#25](https://github.com/rajanaggarwal11/mcpcheck/pull/25) [`2dece05`](https://github.com/rajanaggarwal11/mcpcheck/commit/2dece05bbd2fba193cec6ebf87e2752cd19f7a5d) Thanks [@rajanaggarwal11](https://github.com/rajanaggarwal11)! - **Breaking: mcpcheck's options now go before the server's command.** Everything from the server's command on is passed to the server unchanged. Before, mcpcheck read any of its own flags it found anywhere in argv. That swallowed server flags: in `mcpcheck npx -y @modelcontextprotocol/server-filesystem ./data`, `-y` was taken as an mcpcheck option and npx never got it.

  What changes for you: an mcpcheck option written after the command now goes to the server and no longer affects mcpcheck. `mcpcheck node ./server.js --strict` no longer fails on warnings, `… --json` prints text, and `… --update` doesn't update the snapshot. mcpcheck prints a warning when it sees one of its own flags after the command.

  To migrate, move mcpcheck's options in front of the command:

  ```diff
  - mcpcheck node ./server.js --strict --json
  + mcpcheck --strict --json node ./server.js
  ```

  `--` still ends mcpcheck's options (`mcpcheck --json -- node ./server.js --port 0`), and options after an HTTP URL are still read as mcpcheck's. An unknown option before the command, or a value-taking option with no value (`--snapshot --`), now exits 2 with a message. `--no-color` and `--color` are accepted.

  Also: the `over-broad-tool` error no longer says "the model has a terminal" for tools that evaluate code, such as a browser `eval`. It now reads "executes arbitrary commands or code the model supplies".

## 0.1.1

### Patch Changes

- [#12](https://github.com/rajanaggarwal11/mcpcheck/pull/12) [`458e593`](https://github.com/rajanaggarwal11/mcpcheck/commit/458e593d7ffce3409e05bd65efd8c6e1b8592ba5) Thanks [@rajanaggarwal11](https://github.com/rajanaggarwal11)! - `--timeout` takes a unit: `30s`, `1500ms`, or plain milliseconds as before. Anything else is refused with an example.

## 0.1.0

### Minor Changes

- [`3c7f8f2`](https://github.com/rajanaggarwal11/mcpcheck/commit/3c7f8f259302cf68e561bfb4f4d536085015b720) Thanks [@rajanaggarwal11](https://github.com/rajanaggarwal11)! - First release. Six rules over what an MCP server advertises — contract drift against a
  committed snapshot, description lint (instructions, invisible characters, secrets — in
  descriptions, parameters and the server's instructions field), over-broad tools, annotation
  honesty, schema validity, missing annotations. Never calls a tool. Exit codes 0/1/2, `--json`,
  `--update`, `--` for server flags. Tested against real servers over stdio.
