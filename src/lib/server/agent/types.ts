import { z } from 'zod';

export const IntentOutputSchema = z.object({
	category: z.enum(['ticket', 'prd_update', 'noise', 'unclear']),
	summary: z.string().optional(),
	/** e.g. file or component names */
	fileHints: z.array(z.string()).default([]),
	ticket: z
		.object({
			title: z.string().optional(),
			acceptance: z.array(z.string()).default([]),
			assigneeHint: z.string().optional()
		})
		.optional(),
	prd: z
		.object({
			section: z.string(),
			newBody: z.string()
		})
		.optional()
});

export type IntentOutput = z.infer<typeof IntentOutputSchema>;

export const DraftTicketSchema = z.object({
	title: z.string(),
	description: z.string(),
	fileRefs: z.array(z.string()).default([]),
	acceptance: z.array(z.string()).default([]),
	assigneeHint: z.string().optional()
});

export type DraftTicket = z.infer<typeof DraftTicketSchema>;
