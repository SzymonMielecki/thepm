import { getEnv } from '$lib/server/config';
import { isBridgeReady } from '$lib/server/code-bridge/code-backend';
import { isLinearApiConfigured } from '$lib/server/linear';

export type HubDashboardPageData = {
	bridgeReady: boolean;
	flags: { eleven: boolean; linear: boolean; llm: boolean; ripgrep: boolean };
};

export async function loadHubDashboardPageData(): Promise<HubDashboardPageData> {
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
}
