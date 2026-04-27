import { resolve } from 'node:path';
import { getEnv, projectBaseDir } from './config';
import { getBridgeClientPaths } from './code-bridge/bridge-registry';

/**
 * Repo identity for `ticket_drafts`: bridge client root when a workspace is connected,
 * otherwise the hub's project base dir (THEPM_INVOCATION_CWD / PROJECT_ROOT / cwd).
 * Normalized so listing/inserts compare consistently.
 */
export function getEffectiveTicketProjectRoot(): string {
	const ws = getEnv().codeBridgeWorkspaceId;
	const bridge = getBridgeClientPaths(ws);
	if (bridge?.projectRoot) return resolve(bridge.projectRoot);
	return resolve(projectBaseDir());
}
