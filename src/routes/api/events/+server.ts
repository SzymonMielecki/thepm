import { getBus, type SseEvent } from '$lib/server/bus';
import { assertHubToken } from '$lib/server/auth';
import { error, type RequestEvent } from '@sveltejs/kit';

function sseString(e: SseEvent) {
	return `data: ${JSON.stringify(e)}\n\n`;
}

export const GET = async (event: RequestEvent) => {
	try {
		assertHubToken(event);
	} catch {
		return error(401, 'unauthorized');
	}
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
};
