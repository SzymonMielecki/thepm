import { isCodeBackendBridge, isBridgeReady } from '../code-bridge/code-backend';
import { ensureRipgrep } from '../ripgrep';

/**
 * In local mode, require `rg` on the hub. In bridge mode, require a connected thepm-bridge
 * (ripgrep runs on the dev machine, not the hub).
 */
export async function ensureCodeExploreReady(): Promise<void> {
	if (isCodeBackendBridge()) {
		if (!isBridgeReady()) {
			throw new Error(
				'Code bridge is not connected. Run `thepm-bridge` with the required flags (see `thepm-bridge --help`), or set CODE_BACKEND=local on the hub.'
			);
		}
		return;
	}
	await ensureRipgrep();
}
