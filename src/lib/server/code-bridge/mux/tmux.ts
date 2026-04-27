import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getResolvedTmuxBin } from './tmux-bin';

const execFileAsync = promisify(execFile);

export type TmuxAdapterOptions = {
	session: string;
	flavor: 'tmux' | 'cmux';
	/** Defaults to getResolvedTmuxBin() (cmux claude-teams shim when applicable). */
	tmuxBin?: string;
};

export function createTmuxAdapter(opts: TmuxAdapterOptions) {
	const { session, flavor } = opts;
	const tmuxBin = opts.tmuxBin ?? getResolvedTmuxBin();

	async function tmux(args: string[]): Promise<string> {
		const { stdout } = await execFileAsync(tmuxBin, args, { encoding: 'utf-8' });
		return stdout.trim();
	}

	return {
		flavor,
		session,

		async newWindow(input: { name: string; cwd: string; commandParts: string[] }): Promise<string> {
			const { name, cwd, commandParts } = input;
			// cmux: `new-window` maps to a new sidebar *workspace*; `split-window` keeps agents in the current workspace.
			// https://cmux.com/docs/agent-integrations/claude-code-teams — split-window → splits the current cmux pane.
			const args =
				flavor === 'cmux'
					? [
							'split-window',
							'-d',
							'-c',
							cwd,
							'-P',
							'-F',
							'#{pane_id}',
							'--',
							...commandParts
						]
					: [
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
			const id = (await tmux(args)).trim();
			if (!id) throw new Error(`tmux ${flavor === 'cmux' ? 'split-window' : 'new-window'}: empty target id`);
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
				// cmux split-window returns pane ids (%…); classic tmux new-window returns window ids (@…).
				const out =
					flavor === 'cmux'
						? await tmux(['list-panes', '-F', '#{pane_id}'])
						: await tmux(['list-windows', '-t', session, '-F', '#{window_id}']);
				const ids = out.split('\n').map((s) => s.trim()).filter(Boolean);
				return ids.includes(targetId);
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
				if (flavor === 'cmux') {
					await execFileAsync(tmuxBin, ['kill-pane', '-t', targetId], { encoding: 'utf-8' });
				} else {
					await execFileAsync(tmuxBin, ['kill-window', '-t', targetId], { encoding: 'utf-8' });
				}
			} catch {
				// already gone
			}
		},

		async focusWindow(targetId: string): Promise<void> {
			try {
				if (flavor === 'cmux') {
					await execFileAsync(tmuxBin, ['select-pane', '-t', targetId], { encoding: 'utf-8' });
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
