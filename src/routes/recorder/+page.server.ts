import { isBridgeReady } from '$lib/server/code-bridge/code-backend';
import type { PageServerLoad } from './$types';

type RecorderPageData = {
	bridgeReady: boolean;
};

export const load: PageServerLoad = async (): Promise<RecorderPageData> => {
	return {
		bridgeReady: isBridgeReady()
	};
};
