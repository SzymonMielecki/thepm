/** Minimal frontmatter parser (YAML-like key: value lines); no external deps. */
export function splitFrontmatter(raw: string): { front: string; body: string } {
	const t = raw.replace(/^\uFEFF/, '').trimStart();
	if (!t.startsWith('---\n') && !t.startsWith('---\r\n')) {
		return { front: '', body: raw };
	}
	const rest = t.slice(4);
	const end = rest.indexOf('\n---');
	if (end === -1) return { front: '', body: raw };
	const front = rest.slice(0, end);
	const body = rest.slice(end + 4).replace(/^\r?\n/, '');
	return { front, body };
}

export function parseFrontmatterLines(front: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of front.split(/\r?\n/)) {
		const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (!m) continue;
		out[m[1]] = m[2].trim();
	}
	return out;
}

/** Parse `agents: [a, b, c]` or single line list */
/** `key: |` followed by indented lines until next `word:` key at line start */
export function extractMultilineBlock(front: string, key: string): string {
	const lines = front.split(/\r?\n/);
	let i = 0;
	const prefix = `${key}:`;
	while (i < lines.length) {
		const line = lines[i];
		if (line.startsWith(prefix)) {
			const rest = line.slice(prefix.length).trim();
			if (rest === '|') {
				i++;
				const out: string[] = [];
				while (i < lines.length) {
					const L = lines[i];
					if (/^[A-Za-z0-9_-]+:/.test(L)) break;
					out.push(L);
					i++;
				}
				return out.join('\n').trimEnd();
			}
			return rest;
		}
		i++;
	}
	return '';
}

export function parseAgentsList(value: string | undefined): string[] {
	if (!value?.trim()) return [];
	const v = value.trim();
	const bracket = /^\[(.*)\]$/.exec(v);
	if (bracket) {
		return bracket[1]
			.split(',')
			.map((s) => s.trim().replace(/^["']|["']$/g, ''))
			.filter(Boolean);
	}
	return [];
}
