import { isBridgeReady } from '$lib/server/code-bridge/code-backend';
import type { PageServerLoad } from './$types';

type RecorderPageData = {
	bridgeReady: boolean;
	bridgeSessionActive: boolean;
};

export const load: PageServerLoad = async ({ locals }): Promise<RecorderPageData> => {
	return {
		bridgeReady: isBridgeReady(),
		bridgeSessionActive: !!locals.bridgeSessionActive
	};
};
