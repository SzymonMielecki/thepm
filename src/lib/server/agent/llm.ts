import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { getEnv, type LlmProvider } from '../config';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

function requireKey(provider: LlmProvider) {
	const env = getEnv();
	if (provider === 'openai' && !env.openaiApiKey) {
		throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
	}
	if (provider === 'anthropic' && !env.anthropicApiKey) {
		throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
	}
}

export function getChatModel(): BaseChatModel {
	const env = getEnv();
	const p = (env.llmProvider as LlmProvider) || 'anthropic';
	requireKey(p);
	if (p === 'openai') {
		return new ChatOpenAI({
			apiKey: env.openaiApiKey!,
			model: process.env.OPENAI_MODEL || 'gpt-4.1',
			temperature: 0.2
		});
	}
	return new ChatAnthropic({
		apiKey: env.anthropicApiKey!,
		model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
		temperature: 0.2
	});
}
