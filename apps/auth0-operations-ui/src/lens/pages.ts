import type { IconName } from './ui';

export const lensPages = ['Overview', 'Map', 'Analytics', 'Investigations', 'Alerts', 'Integrations'] as const;
export type LensPage = (typeof lensPages)[number];

export const pageIcons: Record<LensPage, IconName> = {
	Overview: 'overview',
	Map: 'map',
	Analytics: 'analytics',
	Investigations: 'investigations',
	Alerts: 'alerts',
	Integrations: 'integrations',
};

export const rangeLabel = (hours: number) => (hours === 1 ? 'Last hour' : hours === 24 ? 'Last 24 hours' : hours === 168 ? 'Last 7 days' : `Last ${hours} hours`);
