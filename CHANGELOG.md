# mcpcheck

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
