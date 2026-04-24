function utf8ToBase64Url(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function hubTokenToWsSubprotocol(token: string): string {
  return `xhub-${utf8ToBase64Url(token)}`;
}

export function hubTokenToSsePathSegment(token: string): string {
  return utf8ToBase64Url(token);
}
