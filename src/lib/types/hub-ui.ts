/** Mirrors `HubTokenMode` in server config; kept client-safe (no server imports in UI). */
export type HubTokenModeUi = 'explicit' | 'derived' | 'open';

export type HubPageDataFields = {
	hubToken: string;
	hubTokenMode: HubTokenModeUi;
	bridgeReady: boolean;
	bridgeSessionActive: boolean;
};
