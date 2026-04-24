import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const HUB_TOKEN_DERIVE_PREFIX = 'thepm:hubToken:v1:';

function hubTokenAutoDisabled(): boolean {
	const a = (process.env.HUB_TOKEN_AUTO ?? '').toLowerCase().trim();
	return a === '0' || a === 'false' || a === 'off' || a === 'no';
}

/**
 * Stable token for a project directory so the same repo always gets the same HUB_TOKEN
 * without checking secrets into the hub install. Do not use on hostile networks; set HUB_TOKEN explicitly instead.
 */
export function deriveHubTokenForProjectRoot(projectRoot: string): string {
	const normalized = resolve(projectRoot);
	return createHash('sha256')
		.update(HUB_TOKEN_DERIVE_PREFIX + normalized, 'utf8')
		.digest('base64url');
}

export type LlmProvider = 'anthropic' | 'openai' | 'ollama';

export type BridgePrdBootstrapMode = 'if_empty' | 'always' | 'off';

function parseBridgePrdBootstrap(raw: string | undefined): BridgePrdBootstrapMode {
	const s = (raw || 'if_empty').toLowerCase().trim();
	if (s === 'off' || s === '0' || s === 'false' || s === 'no') return 'off';
	if (s === 'always' || s === 'all' || s === '1' || s === 'true' || s === 'yes') return 'always';
	return 'if_empty';
}

/** True when the hub token is derived from the project path (for logs / copy hints). */
export function isHubTokenDerivedFromPath(): boolean {
	if ((process.env.HUB_TOKEN ?? '').trim()) return false;
	if (hubTokenAutoDisabled()) return false;
	return true;
}

export function getEnv() {
	const ollamaBase = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim().replace(/\/$/, '');
	const base = projectBaseDir();
	const explicit = (process.env.HUB_TOKEN ?? '').trim();
	let hubToken: string;
	if (explicit) {
		hubToken = explicit;
	} else if (hubTokenAutoDisabled()) {
		hubToken = '';
	} else {
		hubToken = deriveHubTokenForProjectRoot(base);
	}
	return {
		nodeEnv: process.env.NODE_ENV ?? 'development',
		port: Number(process.env.PORT) || 5173,
		host: process.env.HOST ?? '0.0.0.0',
		/** Single bridge workspace used by this hub (default: `default`). */
		codeBridgeWorkspaceId: (process.env.CODE_BRIDGE_WORKSPACE_ID || 'default').trim() || 'default',
		/**
		 * When the code bridge connects: `if_empty` (default) = generate PRD only if PRD.md is empty or the default stub;
		 * `always` = always overwrite; `off` = never auto-generate.
		 */
		/** `PRD_BOOTSTRAP` (preferred) or `BRIDGE_PRD_BOOTSTRAP` — both local and bridge auto-PRD. */
		bridgePrdBootstrap: parseBridgePrdBootstrap(process.env.PRD_BOOTSTRAP || process.env.BRIDGE_PRD_BOOTSTRAP),
		/** Shared token for WS + SSE; or derived from project path when unset (see HUB_TOKEN_AUTO). */
		hubToken,
		llmProvider: (process.env.LLM_PROVIDER as LlmProvider) || 'anthropic',
		anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim(),
		openaiApiKey: process.env.OPENAI_API_KEY?.trim(),
		ollamaBaseUrl: ollamaBase,
		ollamaModel: (process.env.OLLAMA_MODEL || 'llama3.2').trim(),
		elevenlabsApiKey: process.env.ELEVENLABS_API_KEY?.trim(),
		linearApiKey: process.env.LINEAR_API_KEY?.trim(),
		linearTeamId: process.env.LINEAR_TEAM_ID?.trim(),
		/** Non-realtime default; Realtime WebSocket forces `scribe_v2_realtime` in `realtimeSttQuery()`. */
		elevenlabsSttModel: (process.env.ELEVENLABS_STT_MODEL || 'scribe_v2_realtime').trim()
	};
}

/**
 * When set by `bin/thepm.mjs`, `THEPM_INVOCATION_CWD` wins so the derived HUB_TOKEN and
 * local repo path match the directory where the command was run, not a `PROJECT_ROOT` from the install `.env`.
 */
export function projectBaseDir(): string {
	return resolve(process.env.THEPM_INVOCATION_CWD || process.env.PROJECT_ROOT || process.cwd());
}

export function getProjectPaths() {
	const projectRoot = projectBaseDir();
	const prdPath = resolve(projectRoot, process.env.PRD_PATH || 'PRD.md');
	return { projectRoot, prdPath };
}

