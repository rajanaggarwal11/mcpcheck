# mcpcheck

## 0.1.0

### Minor Changes

- [`3c7f8f2`](https://github.com/rajanaggarwal11/mcpcheck/commit/3c7f8f259302cf68e561bfb4f4d536085015b720) Thanks [@rajanaggarwal11](https://github.com/rajanaggarwal11)! - First release. Six rules over what an MCP server advertises — contract drift against a
  committed snapshot, description lint (instructions, invisible characters, secrets — in
  descriptions, parameters and the server's instructions field), over-broad tools, annotation
  honesty, schema validity, missing annotations. Never calls a tool. Exit codes 0/1/2, `--json`,
  `--update`, `--` for server flags. Tested against real servers over stdio.
