import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama } from '@langchain/community/chat_models/ollama';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getEnv, type LlmProvider } from '../config';
import { type ZodTypeAny, z } from 'zod';

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
	if (p === 'ollama') {
		// Ollama uses SimpleChatModel (no bindTools); JSON mode is required for invokeWithStructuredZod.
		return new ChatOllama({
			baseUrl: env.ollamaBaseUrl,
			model: env.ollamaModel,
			temperature: 0.2,
			format: 'json'
		});
	}
	if (p === 'openai') {
		return new ChatOpenAI({
			apiKey: env.openaiApiKey!,
			model: process.env.OPENAI_MODEL || 'gpt-4.1',
			temperature: 0.2
		});
	}
	const rawModel = process.env.ANTHROPIC_MODEL?.trim();
	// Anthropic Chat API expects ids like `claude-haiku-4-5`; `claude-4-5-haiku-latest` 404s.
	const model =
		rawModel === 'claude-4-5-haiku-latest' || rawModel === 'claude-4-5-haiku'
			? 'claude-haiku-4-5'
			: rawModel || 'claude-3-5-sonnet-20241022';
	return new ChatAnthropic({
		apiKey: env.anthropicApiKey!,
		model,
		temperature: 0.2
	});
}

function messageContentToText(content: BaseMessage['content']): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.map((b) => {
				if (typeof b === 'string') return b;
				if (b && typeof b === 'object' && 'type' in b) {
					if (b.type === 'text' && 'text' in b && typeof (b as { text?: string }).text === 'string') {
						return (b as { text: string }).text;
					}
				}
				return '';
			})
			.join('');
	}
	return String(content);
}

function parseJsonObjectFromLlmText(text: string): unknown {
	const t = text.trim();
	const fence = t.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
	if (fence) {
		return JSON.parse(fence[1]!.trim());
	}
	return JSON.parse(t);
}

/**
 * withStructuredOutput() requires .bindTools() (OpenAI/Anthropic). Ollama’s ChatOllama does not
 * implement that; we use Ollama JSON format + zod instead.
 */
export async function invokeWithStructuredZod<S extends ZodTypeAny>(
	model: BaseChatModel,
	schema: S,
	messages: BaseMessage[]
): Promise<z.infer<S>> {
	if (typeof (model as BaseChatModel & { bindTools?: (tools: unknown) => BaseChatModel }).bindTools === 'function') {
		const structured = model.withStructuredOutput(schema) as { invoke: (m: BaseMessage[]) => Promise<z.infer<S>> };
		const out = await structured.invoke(messages);
		return schema.parse(out);
	}
	const res = await model.invoke(messages);
	const raw = messageContentToText(res.content);
	const parsed = parseJsonObjectFromLlmText(raw);
	return schema.parse(parsed);
}
