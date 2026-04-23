import type { HubPageDataFields } from '$lib/types/hub-ui';

const LS_KEY = 'hubToken';

export function clientHubTokenFromPageData(data: HubPageDataFields): string {
	if (typeof localStorage === 'undefined') {
		return data.hubToken ?? '';
	}
	try {
		const stored = localStorage.getItem(LS_KEY);
		if (stored && stored.trim()) return stored.trim();
	} catch {
		/* private mode, quota */
	}
	return data.hubToken ?? '';
}

export function initMobileHubToken(data: HubPageDataFields): string {
	if (typeof localStorage === 'undefined') {
		return data.hubToken ?? '';
	}
	try {
		const stored = localStorage.getItem(LS_KEY);
		if (stored != null && stored !== '') {
			return stored;
		}
	} catch {
		/* private mode, quota */
	}
	return data.hubToken ?? '';
}

export function persistMobileHubToken(token: string): void {
	if (typeof localStorage === 'undefined') {
		return;
	}
	try {
		const t = token.trim();
		if (t) {
			localStorage.setItem(LS_KEY, t);
		} else {
			localStorage.removeItem(LS_KEY);
		}
	} catch {
		/* ignore */
	}
}

export const persistHubToken = persistMobileHubToken;
