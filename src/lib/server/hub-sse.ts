import { getBus, type SseEvent } from './bus';
import type { RequestEvent } from '@sveltejs/kit';

function sseString(e: SseEvent) {
	return `data: ${JSON.stringify(e)}\n\n`;
}

/** Shared by `GET /api/events` and `GET /api/events/hub/...` (path token = reliable behind some proxies). */
export function createHubSseResponse(event: RequestEvent) {
	const { readable, writable } = new TransformStream();
	const writer = writable.getWriter();
	const encoder = new TextEncoder();
	const bus = getBus();
	const write = (ev: SseEvent) => {
		writer.write(encoder.encode(sseString(ev))).catch(() => {
			// client gone
		});
	};
	const onEv = (ev: unknown) => write(ev as SseEvent);
	bus.on('event', onEv);
	void writer
		.write(
			encoder.encode(
				`data: ${JSON.stringify({ type: 'agent_trace', phase: 'sse', detail: 'connected' })}\n\n`
			)
		)
		.catch(() => {
			// ignore
		});
	event.request.signal.addEventListener('abort', () => {
		bus.off('event', onEv);
		void writer.close();
	});
	return new Response(readable, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive'
		}
	});
}
