# thePM

I've participated in many hackathons. In each and every one of them, I've run into an issue that we've talked about a lot but didn't move. We've lost track of the mentioned issues often and lost what the product really does in this agentic/vibe-coded era. We've often just recorded our conversations and then put it straight into Claude. thePM always listens. You just leave your browser open with microphone on, and issues and PRD are drafted based on all of your brainstorming.

## Usage:

- run `pnpm install` to install the dependencies
- run `pnpm build` to build the bridge binary and server
- run `pnpm start` to start the server
- run `pnpm link --global` to make thePM available globally
- run `thepm bridge --linear-api-key {YOUR_LINEAR_API_KEY} --lin-team-id {YOUR_LINEAR_TEAM_ID}` within the repo you are working on
- open the link given by the above command in your browser, and open the recorder page capture from the link below the header
- start capturing
- the linear issues are created and the PRD will be updated with every accepted ticket

## Agents & delegation

Delegation sends **Claude Code** in a **new tmux/cmux tab** on the machine where **`thepm bridge`** runs (not in the hub process). Requirements on the bridge host:

- `git` (worktrees), `claude` on `PATH` (or override with `THEPM_CLAUDE_BIN`)
- Bridge started inside **tmux** or a shell where **`cmux claude-teams`** has set **`CMUX_SOCKET_PATH`** (the hub uses cmux’s [tmux shim](https://cmux.com/docs/agent-integrations/claude-code-teams) automatically when the socket + shim exist; override with **`THEPM_TMUX_BIN`** if needed). On **cmux**, delegated agents open as **`split-window`** panes in the **current** workspace (the shim maps `new-window` to a new sidebar workspace, which we avoid).

Delegation is **teams only** (no single-agent API target). Pick a catalog team; **one** Claude Code **lead** session opens on the bridge: the bridge sets **`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`** and **`--teammate-mode tmux`** when using tmux/cmux, then sends a lead prompt so Claude spawns **teammates** from `.claude/agents/*.md` per [agent teams](https://code.claude.com/docs/en/agent-teams). A **one-member** team is supported (lead + one teammate). The built-in **default** team uses **sequential** coordination (researcher → coder → reviewer); set **parallel** in the catalog when roles should work independently.

Requires **Claude Code v2.1.32+** and agent teams enabled (the bridge injects the env flag for team delegations). `cmux claude-teams` is still a good way to get a tmux-compatible environment on the bridge host.

Env (optional): `THEPM_WORKTREE_ROOT`, `THEPM_CLAUDE_BIN`, `THEPM_MUX`, `THEPM_MUX_SESSION`, `THEPM_DELEGATION_KEEP_WORKTREE` (`always` | `never` | `on_failure`).

See [`tests/manual/cmux.md`](tests/manual/cmux.md) for a quick manual check.
