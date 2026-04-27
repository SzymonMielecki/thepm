/** Agent markdown bodies for the fixed researcher / coder / reviewer roles. */

import {
	DEFAULT_DELEGATION_TEAM_NAME,
	DEFAULT_TEAM_MEMBER_NAMES
} from '$lib/delegation-constants';

export { DEFAULT_DELEGATION_TEAM_NAME, DEFAULT_TEAM_MEMBER_NAMES };

export type DefaultAgentName = (typeof DEFAULT_TEAM_MEMBER_NAMES)[number];

const PROMPT_TEMPLATE = `Task: {{title}}

Description:
{{description}}

Repository / file hints: {{fileRefs}}

The hub delegates this as a **Claude Code agent team** (https://code.claude.com/docs/en/agent-teams ): you are the **lead** in the spawned session; create teammates using the names and \`.claude/agents/*.md\` definitions already in this worktree. Use CLAUDE.md and the PRD for shared project context.

Best practices: enough context in tasks; separate file ownership for parallel work; sequential phases via task dependencies when coordination is sequential.`;

const AGENT_COPY: Record<
	DefaultAgentName,
	{ description: string; tools: string; model: string; body: string }
> = {
	researcher: {
		description: 'Clarify requirements, scan the codebase, summarize risks and options.',
		tools: '',
		model: '',
		body: `You are the **researcher** on a small delivery team (subagent role; reusable definition per https://code.claude.com/docs/en/agent-teams#use-subagent-definitions-for-teammates ).

- Read the task and PRD context; list unknowns and assumptions.
- Search the repo for relevant modules, patterns, and prior art.
- Output a concise brief the next step can act on (no large code dumps unless necessary).`
	},
	coder: {
		description: 'Implement the change with clear commits and minimal scope creep.',
		tools: '',
		model: '',
		body: `You are the **coder** on a small delivery team (subagent role).

- Implement what the task asks for; follow existing style and patterns.
- Add or update tests when the codebase expects them.
- Keep changes focused; note follow-ups instead of boiling the ocean.
- Prefer owning distinct files from parallel work to avoid conflicts (see agent teams best practices in the same doc).`
	},
	reviewer: {
		description: 'Review for correctness, edge cases, and consistency with the codebase.',
		tools: '',
		model: '',
		body: `You are the **reviewer** on a small delivery team (subagent role).

- Check the implementation against the task and prior brief.
- Call out bugs, missing tests, naming, and security/perf concerns constructively.
- Suggest concrete fixes, not vague criticism.`
	}
};

export function defaultAgentMarkdown(name: DefaultAgentName): string {
	const a = AGENT_COPY[name];
	return `---
name: ${name}
description: ${a.description}
tools: ${a.tools}
model: ${a.model}
---
${a.body}`;
}

export { PROMPT_TEMPLATE as defaultTeamPromptTemplate };
