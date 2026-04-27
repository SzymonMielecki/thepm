# Manual: cmux delegation smoke

1. Start the hub (`pnpm dev` or `pnpm start`).
2. In **cmux**, run **Claude Code Teams** (`cmux claude-teams`). That installs a **tmux shim** at `~/.cmuxterm/claude-teams-bin/tmux` and sets `CMUX_SOCKET_PATH` / fake `TMUX` in that shell — see [Claude Code Teams](https://cmux.com/docs/agent-integrations/claude-code-teams).
3. From **the same shell** (or export `CMUX_SOCKET_PATH`), run `thepm bridge` with the same hub URL and token. The bridge auto-uses the shim when the socket is set so `tmux` commands go to **cmux**, not system tmux (which would error on the wrong socket).
4. If mux still shows “none”, set **`THEPM_TMUX_BIN`** to the shim path above, or **`THEPM_MUX=cmux`** if the shim exists, and optionally **`THEPM_MUX_SESSION`**.
5. Open **Agents** → confirm mux shows `cmux` and a session name.
6. Create a ticket draft and click **Delegate**; a **split** should open in the **current** cmux workspace (the shim maps `new-window` to a new sidebar workspace, so the bridge uses `split-window` instead).
