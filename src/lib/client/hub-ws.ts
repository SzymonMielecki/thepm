/**
 * When a reverse proxy (e.g. some Tailscale Funnel / Serve paths) strips `?token=`
 * from the WebSocket upgrade URL, the hub still needs the bridge access token. Browsers
 * cannot set custom headers on the WS handshake; a subprotocol value is a
 * reliable way to pass it. Server: `xhub-` + base64url(UTF-8) in
 * `Sec-WebSocket-Protocol` — see `hubTokenFromBrowserUpgrade` in the server.
 */
function utf8ToBase64Url(s: string): string {
	const b64 = btoa(unescape(encodeURIComponent(s)));
	return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function hubTokenToWsSubprotocol(token: string): string {
	return `xhub-${utf8ToBase64Url(token)}`;
}

/**
 * For `EventSource` URL `/api/events/hub/{segment}` — same encoding as the `xhub-` payload.
 * (EventSource has no `Authorization` header; some proxies also strip `?token=` on the SSE GET.)
 */
export function hubTokenToSsePathSegment(token: string): string {
	return utf8ToBase64Url(token);
}
