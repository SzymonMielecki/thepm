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
- Bridge started inside **tmux** or a shell where **`cmux claude-teams`** has set **`CMUX_SOCKET_PATH`** (the hub uses cmux’s [tmux shim](https://cmux.com/docs/agent-integrations/claude-code-teams) automatically when the socket + shim exist; override with **`THEPM_TMUX_BIN`** if needed). On **cmux**, the delegated **lead** defaults to **`new-window`** without **`-t`** (the shim does not support session targets; it opens a new workspace on the current socket). Use **`THEPM_CMUX_LEAD_SPAWN=split`** for a **`split-window`** pane in the current workspace instead.

Delegation is **teams only** (no single-agent API target). Pick a catalog team; **one** Claude Code **lead** session opens on the bridge: the bridge sets **`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`**, **`--teammate-mode tmux`** on classic **tmux** only, and **`--teammate-mode auto`** on **cmux** (same default as **`cmux claude-teams`**) so teammate display routes through the shim. Then it sends a lead prompt so Claude spawns **teammates** from `.claude/agents/*.md` per [agent teams](https://code.claude.com/docs/en/agent-teams). A **one-member** team is supported (lead + one teammate). The built-in **default** team uses **sequential** coordination (researcher → coder → reviewer); set **parallel** in the catalog when roles should work independently.

To reduce **permission prompts** for the lead and teammates, set **`THEPM_CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=1`** on the bridge (only in trusted environments), and/or use [Claude Code permissions](https://code.claude.com/en/permissions) in **`.claude/settings.json`** (for example **`permissions.allow`** for `Bash` patterns you trust).

Requires **Claude Code v2.1.32+** and agent teams enabled (the bridge injects the env flag for team delegations). `cmux claude-teams` is still a good way to get a tmux-compatible environment on the bridge host.

Env (optional): `THEPM_WORKTREE_ROOT`, `THEPM_CLAUDE_BIN`, `THEPM_MUX`, `THEPM_MUX_SESSION`, `THEPM_DELEGATION_KEEP_WORKTREE` (`always` | `never` | `on_failure`).

See [`tests/manual/cmux.md`](tests/manual/cmux.md) for a quick manual check.
