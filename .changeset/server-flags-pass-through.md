---
"mcpcheck": patch
---

The server's command line is passed through as written. `mcpcheck npx -y @modelcontextprotocol/server-filesystem ./data` used to read `-y` as an mcpcheck option and drop it, so npx never got it. mcpcheck's options now go before the server's command; every argument from the command on goes to the server, flags included, and `--` still ends mcpcheck's options. An mcpcheck option written after the command (`mcpcheck node ./server.js --update`) now reaches the server instead, and mcpcheck prints a warning saying so. An unknown option before the command is refused with a message that says where server flags go. Options after an HTTP URL are still read as mcpcheck's, since a URL takes no arguments.

The `over-broad-tool` error no longer says "the model has a terminal" for tools that evaluate code, such as a browser `eval`; it now reads "executes arbitrary commands or code the model supplies".
