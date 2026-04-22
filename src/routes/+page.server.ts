import { getEnv } from '$lib/server/config';
import { ensureRipgrep } from '$lib/server/ripgrep';

export const load = async () => {
	let ripgrepOk = true;
	try {
		await ensureRipgrep();
	} catch {
		ripgrepOk = false;
	}
	const e = getEnv();
	const hasLlm = e.llmProvider === 'openai' ? !!e.openaiApiKey : !!e.anthropicApiKey;
	return {
		hubToken: e.hubToken || '',
		flags: {
			eleven: !!e.elevenlabsApiKey,
			linear: !!e.linearApiKey,
			llm: hasLlm,
			ripgrep: ripgrepOk
		}
	};
};
