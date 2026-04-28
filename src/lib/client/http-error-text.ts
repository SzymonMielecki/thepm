/** Best-effort message from a non-OK fetch (SvelteKit `error()` often returns JSON `{ message: string }`). */
export async function responseErrorMessage(r: Response): Promise<string> {
	const raw = await r.text().catch(() => '');
	const t = raw.trim();
	if (!t) return '';
	try {
		const j = JSON.parse(t) as { message?: unknown };
		if (typeof j?.message === 'string' && j.message.trim()) return j.message.trim();
	} catch {
		/* plain text */
	}
	return t;
}
