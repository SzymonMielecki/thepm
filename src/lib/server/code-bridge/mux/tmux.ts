import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getResolvedTmuxBin } from './tmux-bin';

const execFileAsync = promisify(execFile);

export type TmuxAdapterOptions = {
	session: string;
	flavor: 'tmux' | 'cmux';
	/** Defaults to getResolvedTmuxBin() (cmux claude-teams shim when applicable). */
	tmuxBin?: string;
	/**
	 * cmux only: how the delegated lead session is opened.
	 * - `split` (default): `split-window` → new pane in the current workspace.
	 * - `workspace`: `new-window` → new cmux workspace (shim maps away from a pane split; closer to a dedicated surface).
	 * Override with THEPM_CMUX_LEAD_SPAWN=split|workspace on the bridge.
	 */
	cmuxLeadSpawn?: 'split' | 'workspace';
};

function cmuxLeadSpawnFromEnv(): 'split' | 'workspace' {
	const v = (process.env.THEPM_CMUX_LEAD_SPAWN ?? 'workspace').trim().toLowerCase();
	if (v === 'split' || v === 'pane') return 'split';
	return 'workspace';
}

export function createTmuxAdapter(opts: TmuxAdapterOptions) {
	const { session, flavor } = opts;
	const tmuxBin = opts.tmuxBin ?? getResolvedTmuxBin();
	const cmuxLeadSpawn = opts.cmuxLeadSpawn ?? cmuxLeadSpawnFromEnv();

	async function tmux(args: string[]): Promise<string> {
		const { stdout } = await execFileAsync(tmuxBin, args, { encoding: 'utf-8' });
		return stdout.trim();
	}

	return {
		flavor,
		session,

		async newWindow(input: { name: string; cwd: string; commandParts: string[] }): Promise<string> {
			const { name, cwd, commandParts } = input;
			// cmux: `new-window` → new sidebar workspace; `split-window` → new pane in the current workspace.
			// https://cmux.com/docs/agent-integrations/claude-code-teams
			let args: string[];
			let op: string;
			if (flavor === 'cmux' && cmuxLeadSpawn === 'workspace') {
				op = 'new-window';
				// cmux tmux-compat rejects `new-window -t` (no session targeting); workspace is implied from the socket.
				args = [
					'new-window',
					'-d',
					'-n',
					name,
					'-c',
					cwd,
					'-P',
					'-F',
					'#{window_id}',
					'--',
					...commandParts
				];
			} else if (flavor === 'cmux') {
				op = 'split-window';
				args = [
					'split-window',
					'-d',
					'-c',
					cwd,
					'-P',
					'-F',
					'#{pane_id}',
					'--',
					...commandParts
				];
			} else {
				op = 'new-window';
				args = [
					'new-window',
					'-d',
					'-t',
					session,
					'-n',
					name,
					'-c',
					cwd,
					'-P',
					'-F',
					'#{window_id}',
					'--',
					...commandParts
				];
			}
			const id = (await tmux(args)).trim();
			if (!id) throw new Error(`tmux ${op}: empty target id`);
			return id;
		},

		async sendKeys(windowId: string, text: string, submit: boolean): Promise<void> {
			// One literal block + optional Enter — per-line Enter submits each line as a separate prompt in Claude.
			if (text.length > 0) {
				await execFileAsync(tmuxBin, ['send-keys', '-t', windowId, '-l', text], {
					encoding: 'utf-8'
				});
			}
			if (submit) {
				await execFileAsync(tmuxBin, ['send-keys', '-t', windowId, 'Enter'], { encoding: 'utf-8' });
			}
		},

		async isWindowAlive(targetId: string): Promise<boolean> {
			try {
				const ids = new Set<string>();
				if (flavor === 'cmux') {
					try {
						for (const line of (await tmux(['list-panes', '-F', '#{pane_id}'])).split('\n')) {
							const s = line.trim();
							if (s) ids.add(s);
						}
					} catch {
						/* empty */
					}
					try {
						for (const line of (await tmux(['list-windows', '-F', '#{window_id}'])).split('\n')) {
							const s = line.trim();
							if (s) ids.add(s);
						}
					} catch {
						/* empty */
					}
				} else {
					for (const line of (
						await tmux(['list-windows', '-t', session, '-F', '#{window_id}'])
					).split('\n')) {
						const s = line.trim();
						if (s) ids.add(s);
					}
				}
				return ids.has(targetId);
			} catch {
				return false;
			}
		},

		async isPaneDead(windowId: string): Promise<boolean | null> {
			try {
				const out = await tmux(['list-panes', '-t', windowId, '-F', '#{pane_dead}']);
				const parts = out.split('\n').map((s) => s.trim()).filter(Boolean);
				if (!parts.length) return null;
				return parts.every((p) => p === '1');
			} catch {
				return null;
			}
		},

		async killWindow(targetId: string): Promise<void> {
			try {
				if (flavor === 'cmux' && targetId.startsWith('%')) {
					await execFileAsync(tmuxBin, ['kill-pane', '-t', targetId], { encoding: 'utf-8' });
				} else if (flavor === 'cmux') {
					await execFileAsync(tmuxBin, ['kill-window', '-t', targetId], { encoding: 'utf-8' });
				} else {
					await execFileAsync(tmuxBin, ['kill-window', '-t', targetId], { encoding: 'utf-8' });
				}
			} catch {
				// already gone
			}
		},

		async focusWindow(targetId: string): Promise<void> {
			try {
				if (flavor === 'cmux' && targetId.startsWith('%')) {
					await execFileAsync(tmuxBin, ['select-pane', '-t', targetId], { encoding: 'utf-8' });
				} else if (flavor === 'cmux') {
					await execFileAsync(tmuxBin, ['select-window', '-t', targetId], { encoding: 'utf-8' });
				} else {
					await execFileAsync(tmuxBin, ['select-window', '-t', targetId], { encoding: 'utf-8' });
				}
			} catch {
				// best-effort
			}
		},

		async notify(input: { title: string; body: string }): Promise<void> {
			if (flavor !== 'cmux') return;
			try {
				await execFileAsync(
					'cmux',
					['notify', '--title', input.title, '--body', input.body],
					{ encoding: 'utf-8' }
				);
			} catch {
				// optional
			}
		}
	};
}

export type TmuxAdapter = ReturnType<typeof createTmuxAdapter>;
