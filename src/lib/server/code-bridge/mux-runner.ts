import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { detectMuxCapabilities } from './mux/detect';
import { getResolvedTmuxBin } from './mux/tmux-bin';
import { createTmuxAdapter } from './mux/tmux';

const execFileAsync = promisify(execFile);

export type MuxRunState = {
	runId: string;
	workspaceId: string;
	projectRoot: string;
	windowId: string;
	session: string;
	/** tmux executable (cmux shim or system tmux) used for this run */
	tmuxBin: string;
	worktreePath: string;
	branchName: string;
	branchBase: string;
	flavor: 'tmux' | 'cmux';
};

const runs = new Map<string, MuxRunState>();

export function _resetMuxRunsForTests() {
	runs.clear();
}

export function worktreeRootDir(projectRoot: string, workspaceId: string): string {
	const env = (process.env.THEPM_WORKTREE_ROOT ?? '').trim();
	const safeWs = workspaceId.replace(/\W/g, '_') || 'default';
	if (env) return join(env, safeWs);
	return join(dirname(projectRoot), '.thepm-worktrees', safeWs);
}

function claudeCommandParts(): string[] {
	const raw = (process.env.THEPM_CLAUDE_BIN ?? 'claude').trim();
	return raw.split(/\s+/).filter(Boolean);
}

function dangerouslySkipPermissionsEnabled(): boolean {
	const v = (process.env.THEPM_CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS ?? '').trim().toLowerCase();
	return v === '1' || v === 'true' || v === 'yes';
}

/** Claude Code agent teams (https://code.claude.com/docs/en/agent-teams). */
function buildClaudeCommandParts(
	cap: { flavor: 'tmux' | 'cmux' | 'none'; session?: string },
	agentTeams: boolean
): string[] {
	const argv = claudeCommandParts();
	const parts = argv.length ? [...argv] : ['claude'];
	if (dangerouslySkipPermissionsEnabled()) {
		parts.push('--dangerously-skip-permissions');
	}
	if (!agentTeams) return parts;
	const envPairs = ['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1'];
	const withEnv = ['env', ...envPairs, ...parts];
	if (cap.flavor === 'tmux') {
		withEnv.push('--teammate-mode', 'tmux');
	} else if (cap.flavor === 'cmux') {
		// Match `cmux claude-teams` default: split panes when “in tmux” (shim), without forcing `--teammate-mode tmux`.
		withEnv.push('--teammate-mode', 'auto');
	}
	return withEnv;
}

function buildAgentTeamLeadPrompt(
	memberNames: string[],
	coordination: 'parallel' | 'sequential',
	prompt: string
): string {
	const roster = memberNames
		.map((n) => `- **${n}** — use the subagent definition at \`.claude/agents/${n}.md\` when spawning this teammate (exact name).`)
		.join('\n');
	const flow =
		coordination === 'parallel'
			? 'Use **parallel** work: give teammates separate file ownership / subtasks so they do not collide (see agent teams best practices).'
			: 'Use **sequential** coordination: model phases with the shared task list and **dependencies** so researcher finishes before coder, coder before reviewer.';
	const rosterIntro =
		memberNames.length === 1
			? `Create an agent team for the delegated task below. Spawn **one** teammate with this exact name so it loads the project subagent definition:`
			: `Create an agent team for the delegated task below. Spawn teammates with these exact names so they load the project subagent definitions:`;
	return [
		`You are the **team lead** in this worktree. Use Claude Code **agent teams** (https://code.claude.com/docs/en/agent-teams ). **CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS** is already enabled for this session.`,
		``,
		rosterIntro,
		roster,
		``,
		flow,
		``,
		`Task and context:`,
		prompt.trim(),
		``,
		`More detail: .thepm/prompt.md`,
		``,
		`When work is complete, shut down teammates if needed, then **clean up the team** per the docs (only the lead should run cleanup).`
	].join('\n');
}

/** Symlink extra clones into `.thepm/context/` and note them at the bottom of `.thepm/prompt.md`. */
function linkExtraContextReposIntoWorktree(
	worktreePath: string,
	contextRoots: string[],
	promptPath: string
): void {
	if (!contextRoots.length) return;
	const ctxDir = join(worktreePath, '.thepm', 'context');
	mkdirSync(ctxDir, { recursive: true });
	const used = new Set<string>();
	const lines: string[] = [
		'',
		'## Additional repositories (read-only)',
		'Checkouts mirrored under `.thepm/context/<name>/` (from bridge `--context-root`). Hub `read_file` / `write_file` use paths like `__context/0/relative/path` (index matches `--context-root`). Edits in the worktree via these symlinks change the sibling repo on disk.',
		''
	];
	for (let i = 0; i < contextRoots.length; i++) {
		const abs = resolve(contextRoots[i]);
		if (!existsSync(abs)) {
			lines.push(`- (skipped, missing path) \`${abs}\``);
			continue;
		}
		let label = basename(abs).replace(/\W+/g, '_') || `repo_${i}`;
		let cand = label;
		for (let u = 2; used.has(cand); u++) cand = `${label}_${u}`;
		used.add(cand);
		const dest = join(ctxDir, cand);
		try {
			symlinkSync(abs, dest, 'dir');
			lines.push(`- \`.thepm/context/${cand}/\` → \`${abs}\` (\`__context/${i}/...\` on the hub)`);
		} catch (e) {
			lines.push(`- (could not symlink) \`${abs}\`: ${(e as Error).message}`);
		}
	}
	writeFileSync(join(ctxDir, 'README.md'), lines.filter(Boolean).join('\n'), 'utf-8');
	const prev = readFileSync(promptPath, 'utf-8');
	writeFileSync(promptPath, `${prev}\n${lines.join('\n')}`, 'utf-8');
}

export async function handleMuxDispatch(
	ctx: { projectRoot: string; prdPath: string; contextRoots?: string[] },
	args: Record<string, unknown>
): Promise<{
	windowId: string;
	worktreePath: string;
	branchName: string;
	promptFilePath: string;
	flavor: string;
	session: string;
}> {
	const cap = detectMuxCapabilities();
	if (cap.flavor === 'none' || !cap.session) {
		throw new Error(
			'No tmux/cmux session: start the bridge inside tmux or `cmux claude-teams` so delegation can open tabs.'
		);
	}

	const runId = String(args.runId ?? '');
	const workspaceId = String(args.workspaceId ?? 'default');
	const agentName = String(args.agentName ?? '');
	const agentBody = String(args.agentBody ?? '');
	const prompt = String(args.prompt ?? '');
	const branchBase = String(args.branchBase ?? 'HEAD');
	const branchName = String(args.branchName ?? '');
	const tabName = String(args.tabName ?? `thepm-${runId.slice(0, 8)}`);
	const reuseWorktreePath =
		typeof args.reuseWorktreePath === 'string' && args.reuseWorktreePath.trim()
			? String(args.reuseWorktreePath)
			: '';

	const agentTeamMode = args.agentTeamMode === true;
	const teamMemberNames = Array.isArray(args.teamMemberNames)
		? (args.teamMemberNames as unknown[]).map((x) => String(x).trim()).filter(Boolean)
		: [];
	const teamCoordination =
		String(args.teamCoordination ?? 'parallel').toLowerCase() === 'sequential'
			? 'sequential'
			: 'parallel';
	const teamAgentBodies =
		args.teamAgentBodies && typeof args.teamAgentBodies === 'object' && args.teamAgentBodies !== null
			? (args.teamAgentBodies as Record<string, string>)
			: {};

	if (agentTeamMode) {
		if (!runId || !branchName || teamMemberNames.length < 1) {
			throw new Error('mux_dispatch: agent team requires runId, branchName, teamMemberNames (1+)');
		}
	} else if (!runId || !agentName || !branchName) {
		throw new Error('mux_dispatch: runId, agentName, branchName required');
	}

	const projectRoot = ctx.projectRoot;
	try {
		await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
			cwd: projectRoot,
			encoding: 'utf-8'
		});
	} catch {
		throw new Error(
			`Delegation needs a git checkout at the bridge project root (${projectRoot}). ` +
				`That path must be one repository root (contain .git/). ` +
				`If you are in an umbrella folder that only holds several clones, point the bridge ` +
				`at the inner repo (--project-root path/to/that/repo and --prd under it), or cd into that repo first. ` +
				`Or run git init in the directory you use as project root and commit.`
		);
	}
	const root = worktreeRootDir(projectRoot, workspaceId);
	mkdirSync(root, { recursive: true });

	let worktreePath: string;
	if (reuseWorktreePath) {
		worktreePath = reuseWorktreePath;
	} else {
		worktreePath = join(root, runId);
		await execFileAsync(
			'git',
			['-C', projectRoot, 'worktree', 'add', worktreePath, '-b', branchName, branchBase],
			{ encoding: 'utf-8' }
		);
	}

	const agentsDir = join(worktreePath, '.claude', 'agents');
	mkdirSync(agentsDir, { recursive: true });
	if (agentTeamMode) {
		for (const name of teamMemberNames) {
			const body = teamAgentBodies[name] ?? '';
			const agentFile = join(agentsDir, `${name}.md`);
			if (!existsSync(agentFile) && body.trim()) {
				writeFileSync(agentFile, body, 'utf-8');
			}
		}
	} else {
		const agentFile = join(agentsDir, `${agentName}.md`);
		if (!existsSync(agentFile) && agentBody.trim()) {
			writeFileSync(agentFile, agentBody, 'utf-8');
		}
	}

	const thepmDir = join(worktreePath, '.thepm');
	mkdirSync(thepmDir, { recursive: true });
	const promptPath = join(thepmDir, 'prompt.md');
	writeFileSync(promptPath, prompt, 'utf-8');
	linkExtraContextReposIntoWorktree(worktreePath, ctx.contextRoots ?? [], promptPath);

	const tmuxBin = getResolvedTmuxBin();
	const adapter = createTmuxAdapter({ session: cap.session, flavor: cap.flavor, tmuxBin });
	const cmd = buildClaudeCommandParts(cap, agentTeamMode);
	const windowId = await adapter.newWindow({
		name: tabName.slice(0, 80),
		cwd: worktreePath,
		commandParts: cmd.length ? cmd : ['claude']
	});

	runs.set(runId, {
		runId,
		workspaceId,
		projectRoot,
		windowId,
		session: cap.session,
		tmuxBin,
		worktreePath,
		branchName,
		branchBase,
		flavor: cap.flavor
	});

	await new Promise((r) => setTimeout(r, 500));

	const invoke = agentTeamMode
		? buildAgentTeamLeadPrompt(teamMemberNames, teamCoordination, prompt)
		: [
				`Delegated work: act in this worktree using the **@${agentName}** subagent.`,
				`Role definition: .claude/agents/${agentName}.md`,
				`Read project context (CLAUDE.md, PRD) as needed; full task brief is below and in .thepm/prompt.md.`,
				``,
				prompt.trim()
			].join('\n');
	await adapter.sendKeys(windowId, invoke, true);

	return {
		windowId,
		worktreePath,
		branchName,
		promptFilePath: promptPath,
		flavor: cap.flavor,
		session: cap.session
	};
}

export async function handleMuxStatus(
	args: Record<string, unknown>
): Promise<{ runId: string; alive: boolean; exitCode: number | null }[]> {
	const runIds = Array.isArray(args.runIds) ? (args.runIds as unknown[]).map(String) : [];
	const out: { runId: string; alive: boolean; exitCode: number | null }[] = [];
	for (const runId of runIds) {
		const st = runs.get(runId);
		if (!st) {
			out.push({ runId, alive: false, exitCode: null });
			continue;
		}
		const adapter = createTmuxAdapter({
			session: st.session,
			flavor: st.flavor,
			tmuxBin: st.tmuxBin ?? getResolvedTmuxBin()
		});
		const winAlive = await adapter.isWindowAlive(st.windowId);
		let alive = winAlive;
		if (winAlive) {
			const dead = await adapter.isPaneDead(st.windowId);
			if (dead === true) alive = false;
		}
		out.push({ runId, alive, exitCode: alive ? null : 0 });
	}
	return out;
}

/** Kill the tmux tab and drop run state; diff is computed while the worktree still exists. */
export async function handleMuxCancel(args: Record<string, unknown>): Promise<{ ok: boolean; diffStat: string }> {
	const runId = String(args.runId ?? '');
	const st = runs.get(runId);
	let diffStat = '';
	if (st) {
		try {
			const { stdout } = await execFileAsync(
				'git',
				['-C', st.projectRoot, 'diff', '--stat', `${st.branchBase}...${st.branchName}`],
				{ encoding: 'utf-8' }
			);
			diffStat = stdout.trim();
		} catch {
			/* empty branch or invalid ref */
		}
		const adapter = createTmuxAdapter({
			session: st.session,
			flavor: st.flavor,
			tmuxBin: st.tmuxBin ?? getResolvedTmuxBin()
		});
		await adapter.killWindow(st.windowId);
		runs.delete(runId);
	}
	return { ok: true, diffStat };
}

export async function handleMuxRemoveWorktree(
	projectRoot: string,
	args: Record<string, unknown>
): Promise<{ ok: boolean }> {
	const path = String(args.path ?? '').trim();
	if (!path) throw new Error('mux_remove_worktree: path required');
	await execFileAsync('git', ['-C', projectRoot, 'worktree', 'remove', '-f', path], {
		encoding: 'utf-8'
	});
	return { ok: true };
}

export async function handleMuxFocus(args: Record<string, unknown>): Promise<{ ok: boolean }> {
	const runId = String(args.runId ?? '');
	const st = runs.get(runId);
	if (!st) return { ok: false };
	const adapter = createTmuxAdapter({
		session: st.session,
		flavor: st.flavor,
		tmuxBin: st.tmuxBin ?? getResolvedTmuxBin()
	});
	await adapter.focusWindow(st.windowId);
	return { ok: true };
}

export async function handleMuxNotify(args: Record<string, unknown>): Promise<{ ok: boolean }> {
	const title = String(args.title ?? 'thepm');
	const body = String(args.body ?? '');
	const cap = detectMuxCapabilities();
	if (cap.flavor !== 'cmux') return { ok: false };
	const adapter = createTmuxAdapter({
		session: cap.session ?? '',
		flavor: 'cmux',
		tmuxBin: getResolvedTmuxBin()
	});
	if (!cap.session) return { ok: false };
	await adapter.notify({ title, body });
	return { ok: true };
}

export function getMuxRunState(runId: string): MuxRunState | undefined {
	return runs.get(runId);
}
