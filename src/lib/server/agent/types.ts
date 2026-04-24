import { z } from 'zod';

/** Classifiers and tools often emit `body` or omit the field; normalize to newBody. */
const prdSectionPatchIn = z.object({
	section: z.string(),
	newBody: z.string().optional(),
	body: z.string().optional()
});

export const IntentOutputSchema = z.object({
	category: z.enum(['ticket', 'prd_update', 'noise', 'unclear']),
	summary: z.string().optional(),
	/**
	 * When category is `prd_update`: set true if the utterance also implies concrete engineering
	 * work (bugfix, feature build, refactor) so a draft ticket is created after the PRD patch.
	 */
	alsoCreateTicket: z.boolean().optional().default(false),
	/** e.g. file or component names */
	fileHints: z.array(z.string()).default([]),
	ticket: z
		.object({
			title: z.string().optional(),
			acceptance: z.array(z.string()).default([]),
			assigneeHint: z.string().optional()
		})
		.optional(),
	prd: prdSectionPatchIn
		.transform((o) => ({
			section: o.section.trim(),
			newBody: (o.newBody ?? o.body ?? '').trim()
		}))
		.optional()
});

export type IntentOutput = z.infer<typeof IntentOutputSchema>;

/** Second-pass PRD patch after ripgrep / file context (section heading + new body). */
export const PrdSectionPatchSchema = prdSectionPatchIn.transform((o) => ({
	section: o.section.trim(),
	newBody: (o.newBody ?? o.body ?? '').trim()
}));

export type PrdSectionPatch = z.infer<typeof PrdSectionPatchSchema>;

export const DraftTicketSchema = z.object({
	title: z.string(),
	description: z.string(),
	fileRefs: z.array(z.string()).default([]),
	acceptance: z.array(z.string()).default([]),
	assigneeHint: z.string().optional(),
	assigneeUserId: z.string().optional()
});

export type DraftTicket = z.infer<typeof DraftTicketSchema>;
