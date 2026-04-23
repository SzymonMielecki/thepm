import { getEnv } from '$lib/server/config';
import { ensureRipgrep } from '$lib/server/ripgrep';
import { isCodeBackendBridge, isBridgeReady } from '$lib/server/code-bridge/code-backend';

export const load = async () => {
	let ripgrepOk = true;
	try {
		if (isCodeBackendBridge()) {
			ripgrepOk = isBridgeReady();
		} else {
			await ensureRipgrep();
		}
	} catch {
		ripgrepOk = false;
	}
	const e = getEnv();
	const hasLlm =
		e.llmProvider === 'ollama'
			? true
			: e.llmProvider === 'openai'
				? !!e.openaiApiKey
				: !!e.anthropicApiKey;
	return {
		hubToken: e.hubToken || '',
		codeBackend: e.codeBackend,
		flags: {
			eleven: !!e.elevenlabsApiKey,
			linear: !!e.linearApiKey,
			llm: hasLlm,
			ripgrep: ripgrepOk
		}
	};
};
