import type { summarize, OtherEvent, Event } from '../loginLensAnalytics';
import type { Anomaly } from '../lensRules';
import type { exampleInventory } from '../lensExample';
import type { LensPage } from './pages';

/** Read-only snapshot of LoginLens state shared by the page components. */
export type LensView = {
	data: ReturnType<typeof summarize> | null;
	alerts: Anomaly[];
	highPriority: number;
	sample: boolean;
	loading: boolean;
	connected: boolean;
	updated: number | null;
	hours: number;
	skipped: number;
	otherEvents: OtherEvent[];
	inventory: ReturnType<typeof exampleInventory> | null;
	navigate: (page: LensPage) => void;
	openAnomaly: (anomaly: Anomaly) => void;
	openEvent: (event: Event) => void;
	eventReviewAvailable: boolean;
	newFailureIds: string[];
	newMfaIds: string[];
	markFailureSeen: (id: string) => void;
	openAccount: () => void;
};

export const dataState = (view: LensView) => (view.data ? 'ready' : view.loading ? 'loading' : 'unavailable') as 'ready' | 'loading' | 'unavailable';
