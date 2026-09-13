---
"mcpcheck": minor
---

First release. Six rules over what an MCP server advertises — contract drift against a
committed snapshot, description lint (instructions, invisible characters, secrets — in
descriptions, parameters and the server's instructions field), over-broad tools, annotation
honesty, schema validity, missing annotations. Never calls a tool. Exit codes 0/1/2, `--json`,
`--update`, `--` for server flags. Tested against real servers over stdio.
