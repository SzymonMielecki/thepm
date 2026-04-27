import { loadHubDashboardPageData } from '$lib/server/hub-page-load';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => loadHubDashboardPageData();
