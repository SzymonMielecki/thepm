const API_KEY_FLAG = '--linear-api-key';
const TEAM_ID_FLAG = '--linear-team-id';

/**
 * Reads `--linear-api-key` / `--linear-team-id` plus the following argv token
 * and sets `process.env` so `getEnv()` picks them up. CLI wins over `.env` when both are set.
 */
export function applyLinearCliEnvFromArgv(argv: string[]): void {
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a !== API_KEY_FLAG && a !== TEAM_ID_FLAG) continue;
		const next = argv[i + 1];
		if (next === undefined || next.startsWith('-')) continue;
		if (a === API_KEY_FLAG) process.env.LINEAR_API_KEY = next;
		else process.env.LINEAR_TEAM_ID = next;
		i++;
	}
}
