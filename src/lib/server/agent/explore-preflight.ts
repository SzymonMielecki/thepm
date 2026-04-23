import { isBridgeReady } from '../code-bridge/code-backend';

/**
 * Require a connected bridge (ripgrep executes on the bridge machine).
 */
export async function ensureCodeExploreReady(): Promise<void> {
	if (!isBridgeReady()) {
		throw new Error(
			'Code bridge is not connected. Run `thepm bridge` with the required flags (see `thepm bridge --help`).'
		);
	}
}
