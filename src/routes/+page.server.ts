import { getEnv } from '$lib/server/config';
import { isBridgeReady } from '$lib/server/code-bridge/code-backend';
import { isLinearApiConfigured } from '$lib/server/linear';
import type { PageServerLoad } from './$types';

type IndexPageData = {
	bridgeReady: boolean;
	flags: { eleven: boolean; linear: boolean; llm: boolean; ripgrep: boolean };
};

export const load: PageServerLoad = async ({ locals }): Promise<IndexPageData> => {
	const ripgrepOk = isBridgeReady();
	const e = getEnv();
	const hasLlm =
		e.llmProvider === 'ollama'
			? true
			: e.llmProvider === 'openai'
				? !!e.openaiApiKey
				: !!e.anthropicApiKey;
	return {
		bridgeReady: ripgrepOk,
		flags: {
			eleven: !!e.elevenlabsApiKey,
			linear: isLinearApiConfigured(),
			llm: hasLlm,
			ripgrep: ripgrepOk
		}
	};
};
