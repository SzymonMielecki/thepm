import type { HubTokenMode } from '$lib/server/config';
import { isBridgeReady } from '$lib/server/code-bridge/code-backend';
import type { PageServerLoad } from './$types';

type MobilePageData = {
	hubToken: string;
	hubTokenMode: HubTokenMode;
	bridgeReady: boolean;
	bridgeSessionActive: boolean;
};

export const load: PageServerLoad = async ({ locals }): Promise<MobilePageData> => {
	return {
		hubToken: '',
		hubTokenMode: 'open',
		bridgeReady: isBridgeReady(),
		bridgeSessionActive: !!locals.bridgeSessionActive
	};
};
