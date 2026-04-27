import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** cmux `claude-teams` installs a tmux shim here; see https://cmux.com/docs/agent-integrations/claude-code-teams */
export function cmuxClaudeTeamsTmuxShimPath(): string {
	return join(homedir(), '.cmuxterm', 'claude-teams-bin', 'tmux');
}

/**
 * Executable used for tmux-compat commands on the bridge host.
 * When cmux is active, system `tmux` often targets the wrong socket; prefer the claude-teams shim.
 */
export function getResolvedTmuxBin(): string {
	const override = (process.env.THEPM_TMUX_BIN ?? '').trim();
	if (override) return override;
	const shim = cmuxClaudeTeamsTmuxShimPath();
	const muxMode = (process.env.THEPM_MUX ?? 'auto').trim().toLowerCase();
	const hasCmuxSocket = !!(process.env.CMUX_SOCKET_PATH ?? '').trim();
	const useShim =
		existsSync(shim) &&
		(hasCmuxSocket || muxMode === 'cmux' || !!(process.env.TMUX ?? '').trim());
	if (useShim) return shim;
	return 'tmux';
}
