import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type LlmProvider = 'anthropic' | 'openai' | 'ollama';

/**
 * - `local` (default): read/search repo in-process (same machine as the hub).
 * - `bridge`: code ops and PRD file live on a connected `thepm-bridge` (outbound WSS to this hub). Required for a cloud hub to see a developer’s machine.
 */
export type CodeBackendMode = 'local' | 'bridge';

export function getEnv() {
	const ollamaBase = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim().replace(/\/$/, '');
	const codeBackendRaw = (process.env.CODE_BACKEND || 'local').toLowerCase().trim();
	const codeBackend: CodeBackendMode = codeBackendRaw === 'bridge' ? 'bridge' : 'local';
	return {
		nodeEnv: process.env.NODE_ENV ?? 'development',
		port: Number(process.env.PORT) || 3000,
		host: process.env.HOST ?? '0.0.0.0',
		codeBackend,
		/** When CODE_BACKEND=bridge, only this workspace’s bridge is used (default: `default`). */
		codeBridgeWorkspaceId: (process.env.CODE_BRIDGE_WORKSPACE_ID || 'default').trim() || 'default',
		/** HMAC or shared token for WS + SSE + MCP */
		hubToken: process.env.HUB_TOKEN?.trim() || '',
		llmProvider: (process.env.LLM_PROVIDER as LlmProvider) || 'anthropic',
		anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim(),
		openaiApiKey: process.env.OPENAI_API_KEY?.trim(),
		ollamaBaseUrl: ollamaBase,
		ollamaModel: (process.env.OLLAMA_MODEL || 'llama3.2').trim(),
		elevenlabsApiKey: process.env.ELEVENLABS_API_KEY?.trim(),
		linearApiKey: process.env.LINEAR_API_KEY?.trim(),
		linearTeamId: process.env.LINEAR_TEAM_ID?.trim(),
		/** Non-realtime default; Realtime WebSocket forces `scribe_v2_realtime` in `realtimeSttQuery()`. */
		elevenlabsSttModel: (process.env.ELEVENLABS_STT_MODEL || 'scribe_v2_realtime').trim(),
		databasePath: process.env.DATABASE_PATH || join(process.cwd(), 'data', 'app.db')
	};
}

export function getProjectPaths() {
	const projectRoot = resolve(process.env.PROJECT_ROOT || process.cwd());
	const prdPath = resolve(projectRoot, process.env.PRD_PATH || 'PRD.md');
	return { projectRoot, prdPath };
}

export const serverRoot = join(__dirname, '../../../..');
