import type { RipgrepResult } from '../ripgrep';

export type CodeOpName =
	| 'read_file'
	| 'list_dir'
	| 'ripgrep'
	| 'prd_read'
	| 'prd_patch'
	| 'prd_write_full'
	| 'mux_capabilities'
	| 'mux_dispatch'
	| 'mux_status'
	| 'mux_cancel'
	| 'mux_remove_worktree'
	| 'mux_focus'
	| 'mux_notify'
	| 'get_delegation_repo_files';

export type CodeReqMessage = {
	type: 'code_req';
	id: string;
	op: CodeOpName;
	args: Record<string, unknown>;
};

export type CodeResMessage =
	| { type: 'code_res'; id: string; ok: true; result: unknown }
	| { type: 'code_res'; id: string; ok: false; error: string };

export type BridgeHelloMessage = {
	type: 'bridge_hello';
	workspaceId: string;
	projectRoot?: string;
	prdPath?: string;
	/** e.g. basename of project root */
	clientLabel?: string;
	/** From bridge CLI; hub merges with LINEAR_* env. */
	linearApiKey?: string;
	linearTeamId?: string;
};

export type PrdPatchBridgeResult = {
	ok: true;
	before: string;
	after: string;
	content: string;
};

export function isPrdPatchBridgeResult(
	x: unknown
): x is PrdPatchBridgeResult {
	if (!x || typeof x !== 'object') return false;
	const o = x as PrdPatchBridgeResult;
	return o.ok === true && typeof o.before === 'string' && typeof o.after === 'string' && typeof o.content === 'string';
}

export type RipgrepResultPayload = { hits: RipgrepResult[] };
