---
"mcpcheck": minor
---

**Breaking: mcpcheck's options now go before the server's command.** Everything from the server's command on is passed to the server unchanged. Before, mcpcheck read any of its own flags it found anywhere in argv. That swallowed server flags: in `mcpcheck npx -y @modelcontextprotocol/server-filesystem ./data`, `-y` was taken as an mcpcheck option and npx never got it.

What changes for you: an mcpcheck option written after the command now goes to the server and no longer affects mcpcheck. `mcpcheck node ./server.js --strict` no longer fails on warnings, `… --json` prints text, and `… --update` doesn't update the snapshot. mcpcheck prints a warning when it sees one of its own flags after the command.

To migrate, move mcpcheck's options in front of the command:

```diff
- mcpcheck node ./server.js --strict --json
+ mcpcheck --strict --json node ./server.js
```

`--` still ends mcpcheck's options (`mcpcheck --json -- node ./server.js --port 0`), and options after an HTTP URL are still read as mcpcheck's. An unknown option before the command, or a value-taking option with no value (`--snapshot --`), now exits 2 with a message. `--no-color` and `--color` are accepted.

Also: the `over-broad-tool` error no longer says "the model has a terminal" for tools that evaluate code, such as a browser `eval`. It now reads "executes arbitrary commands or code the model supplies".
