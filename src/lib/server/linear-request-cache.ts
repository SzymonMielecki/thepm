/**
 * In-memory cache for Linear API responses to reduce rate-limit pressure.
 * Optional: LINEAR_CACHE_TTL_SECONDS (default: 60 for issues, 600 for metadata).
 */

type Kind = 'issues' | 'meta';

type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();
const MAX_KEYS = 500;

function pruneForInsert() {
	if (store.size < MAX_KEYS) return;
	const now = Date.now();
	for (const [k, v] of store) {
		if (v.expiresAt <= now) store.delete(k);
	}
	if (store.size < MAX_KEYS) return;
	/** Drop ~10% of oldest by insertion order (Map preserves insert order) */
	const drop = Math.max(1, Math.floor(store.size * 0.1));
	let i = 0;
	for (const k of store.keys()) {
		store.delete(k);
		if (++i >= drop) break;
	}
}

function ttlMsFromEnv(name: string, defaultSeconds: number): number {
	const raw = process.env[name];
	if (raw) {
		const s = Number.parseInt(raw, 10);
		if (Number.isFinite(s) && s >= 5) return s * 1000;
	}
	return defaultSeconds * 1000;
}

function ttlMs(kind: Kind): number {
	if (kind === 'issues') return ttlMsFromEnv('LINEAR_CACHE_TTL_SECONDS', 60);
	return ttlMsFromEnv('LINEAR_CACHE_META_TTL_SECONDS', 600);
}

function isRateLimitError(e: unknown): boolean {
	if (e && typeof e === 'object' && 'type' in e) {
		const t = (e as { type?: { toString: () => string } }).type;
		const s = t != null ? String(t) : '';
		if (s === 'Ratelimited' || /ratelimit/i.test(s)) return true;
	}
	const msg = e instanceof Error ? e.message : String(e);
	return /rate limit|ratelimit|Ratelimited|429/i.test(msg);
}

export function linearIssuesCacheKey(
	ws: string,
	input: {
		firstNorm: number;
		after?: string | null;
		stateId?: string | null;
		assigneeId?: string | null;
		priority?: number | null;
		titleContains?: string | null;
	}
): string {
	const first = String(input.firstNorm);
	return [
		'issues',
		ws,
		first,
		input.after?.trim() ?? '',
		input.stateId?.trim() ?? '',
		input.assigneeId?.trim() ?? '',
		input.priority != null && !Number.isNaN(input.priority) ? String(input.priority) : '',
		input.titleContains?.trim() ?? ''
	].join('\x1e');
}

export function linearMetaCacheKey(
	kind: 'states' | 'users',
	ws: string,
	extra: string
): string {
	return `${kind}\x1e${ws}\x1e${extra}`;
}

/**
 * Return cached value when fresh; on error from `fetcher`, return last value if
 * the error looks like a rate limit (stale-while-error).
 */
export async function withLinearResponseCache<T>(key: string, kind: Kind, fetcher: () => Promise<T>): Promise<T> {
	const now = Date.now();
	const hit = store.get(key);
	if (hit && hit.expiresAt > now) {
		return hit.value as T;
	}
	try {
		const value = await fetcher();
		pruneForInsert();
		store.set(key, { value, expiresAt: now + ttlMs(kind) });
		return value;
	} catch (e) {
		if (hit && isRateLimitError(e)) {
			return hit.value as T;
		}
		throw e;
	}
}
