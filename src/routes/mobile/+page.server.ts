import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const RECORDER = '/recorder' as const;

/**
 * @deprecated The recorder PWA lives at `/recorder`. Old links and the PWA manifest
 * can keep `/mobile` for compatibility.
 */
export const load: PageServerLoad = async ({ url }) => {
	const q = url.search;
	throw redirect(308, q ? `${RECORDER}${q}` : RECORDER);
};
