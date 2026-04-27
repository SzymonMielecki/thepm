import { execFileSync } from 'node:child_process';
import { getResolvedTmuxBin } from './tmux-bin';

export type MuxFlavor = 'tmux' | 'cmux' | 'none';

export type MuxCapabilities = {
	flavor: MuxFlavor;
	/** tmux session name; required when flavor !== 'none' */
	session?: string;
};

export { getResolvedTmuxBin } from './tmux-bin';

/**
 * Resolve tmux session name: prefer explicit pane, then current client, then list-sessions.
 * With cmux, use the claude-teams tmux shim (see getResolvedTmuxBin) so commands hit cmux, not system tmux.
 */
function tryResolveTmuxSession(pane: string | undefined, tmuxBin: string): string | undefined {
	const p = pane?.trim();
	if (p) {
		try {
			const s = execFileSync(tmuxBin, ['display-message', '-p', '-t', p, '#S'], {
				encoding: 'utf-8'
			}).trim();
			if (s) return s;
		} catch {
			/* try fallbacks */
		}
	}
	try {
		const s = execFileSync(tmuxBin, ['display-message', '-p', '#S'], {
			encoding: 'utf-8'
		}).trim();
		if (s) return s;
	} catch {
		/* list-sessions */
	}
	try {
		const out = execFileSync(
			tmuxBin,
			['list-sessions', '-F', '#{session_attached}\t#{session_name}'],
			{ encoding: 'utf-8' }
		);
		let fallback: string | undefined;
		for (const line of out.split('\n')) {
			const t = line.trim();
			if (!t) continue;
			const tab = t.indexOf('\t');
			if (tab === -1) continue;
			const att = t.slice(0, tab);
			const name = t.slice(tab + 1).trim();
			if (!name) continue;
			if (att === '1') return name;
			if (!fallback) fallback = name;
		}
		if (fallback) return fallback;
	} catch {
		/* no server */
	}
	return undefined;
}

/**
 * Detect multiplexer for delegation. cmux claude-teams sets CMUX_SOCKET_PATH and may fake TMUX / TMUX_PANE.
 * Override with THEPM_MUX=tmux|cmux|none|auto and THEPM_MUX_SESSION (session name when pane/client detection fails).
 */
export function detectMuxCapabilities(): MuxCapabilities {
	const override = (process.env.THEPM_MUX ?? 'auto').trim().toLowerCase();
	const sessionOverride = (process.env.THEPM_MUX_SESSION ?? '').trim();
	const hasCmuxSocket = !!(process.env.CMUX_SOCKET_PATH ?? '').trim();
	const tmuxEnv = (process.env.TMUX ?? '').trim();
	const pane = (process.env.TMUX_PANE ?? '').trim();

	if (override === 'none') {
		return { flavor: 'none' };
	}

	let flavor: MuxFlavor = 'none';
	if (override === 'cmux') {
		if (hasCmuxSocket || tmuxEnv) flavor = 'cmux';
	} else if (override === 'tmux') {
		if (tmuxEnv) flavor = 'tmux';
	} else {
		if (hasCmuxSocket) flavor = 'cmux';
		else if (tmuxEnv) flavor = 'tmux';
	}

	if (flavor === 'none') {
		return { flavor: 'none' };
	}

	if (sessionOverride) {
		return { flavor, session: sessionOverride };
	}

	const tmuxBin = getResolvedTmuxBin();
	const session = tryResolveTmuxSession(pane || undefined, tmuxBin);
	if (!session) {
		return { flavor: 'none' };
	}
	return { flavor, session };
}
