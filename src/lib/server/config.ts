import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type LlmProvider = 'anthropic' | 'openai';

export function getEnv() {
	return {
		nodeEnv: process.env.NODE_ENV ?? 'development',
		port: Number(process.env.PORT) || 3000,
		host: process.env.HOST ?? '0.0.0.0',
		/** HMAC or shared token for WS + SSE + MCP */
		hubToken: process.env.HUB_TOKEN?.trim() || '',
		llmProvider: (process.env.LLM_PROVIDER as LlmProvider) || 'anthropic',
		anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim(),
		openaiApiKey: process.env.OPENAI_API_KEY?.trim(),
		elevenlabsApiKey: process.env.ELEVENLABS_API_KEY?.trim(),
		linearApiKey: process.env.LINEAR_API_KEY?.trim(),
		linearTeamId: process.env.LINEAR_TEAM_ID?.trim(),
		/** Scribe / speech-to-text - ElevenLabs (model id from their docs) */
		elevenlabsSttModel: (process.env.ELEVENLABS_STT_MODEL || 'scribe_v1').trim(),
		databasePath: process.env.DATABASE_PATH || join(process.cwd(), 'data', 'app.db')
	};
}

export function getProjectPaths() {
	const projectRoot = resolve(process.env.PROJECT_ROOT || process.cwd());
	const prdPath = resolve(projectRoot, process.env.PRD_PATH || 'PRD.md');
	return { projectRoot, prdPath };
}

export const serverRoot = join(__dirname, '../../../..');
