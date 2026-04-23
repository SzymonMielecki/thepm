/** WebSocket clients on `/api/audio/stream` — shared by server registry, API, SSE, and hub UI. */
export type CaptureClientInfo = {
	id: string;
	sessionId: string;
	connectedAt: number;
	userAgent: string | null;
	remoteAddress: string | null;
};
