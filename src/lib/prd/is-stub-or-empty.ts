/** Heuristic: default stub from getPrdContent or nearly empty. Shared by hub UI and server bootstrap. */
export function isStubOrEmptyPrd(text: string): boolean {
	const t = text.replace(/\r\n/g, '\n').trim();
	if (t.length < 32) return true;
	if (
		/^# Product Requirements \(Root\)\s*\n+\s*## Vision\s*\n+\s*## Goals\s*\n+\s*## Decisions\s*\n*$/i.test(
			t
		)
	) {
		return true;
	}
	if (t.length < 200 && !/feature|user story|stakeholder|api\b/i.test(t)) {
		return true;
	}
	return false;
}
