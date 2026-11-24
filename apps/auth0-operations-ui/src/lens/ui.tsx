import React from 'react';

const paths = {
	overview: <><path d="M4 11.5 12 5l8 6.5" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" /></>,
	map: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5S9.5 6.1 12 3.5Z" /></>,
	analytics: <><path d="M5 19V11" /><path d="M10 19V6" /><path d="M15 19v-5" /><path d="M20 19V9" /></>,
	investigations: <><path d="m12 3.5 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4" /><path d="m4 16.5 8 4 8-4" /></>,
	alerts: <><path d="M6.5 16.5V11a5.5 5.5 0 1 1 11 0v5.5l1.5 2h-14l1.5-2Z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
	integrations: <><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></>,
	shield: <><path d="M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6l7-2.5Z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
	check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
	failure: <><circle cx="12" cy="12" r="8.5" /><path d="m9 9 6 6M15 9l-6 6" /></>,
	userPlus: <><circle cx="10" cy="8.5" r="3.5" /><path d="M3.5 19.5c.8-3.3 3.3-5 6.5-5s5.7 1.7 6.5 5" /><path d="M19 8v6M16 11h6" /></>,
	users: <><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19c.7-3 2.8-4.6 5.5-4.6s4.8 1.6 5.5 4.6" /><path d="M15.5 6.2a3 3 0 0 1 0 5.6M17 14.6c1.8.5 3 1.9 3.5 4.4" /></>,
	filter: <path d="M4 5.5h16l-6.2 7.4v5.4l-3.6 1.7v-7.1L4 5.5Z" />,
	arrowRight: <path d="M5 12h14m-5-5 5 5-5 5" />,
	arrowLeft: <path d="M19 12H5m5-5-5 5 5 5" />,
	calendar: <><rect x="4" y="5.5" width="16" height="14" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>,
	refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></>,
	sparkle: <path d="M12 4c.6 3.9 2.1 5.4 6 6-3.9.6-5.4 2.1-6 6-.6-3.9-2.1-5.4-6-6 3.9-.6 5.4-2.1 6-6Z" />,
	engine: <><rect x="4" y="5" width="16" height="6" rx="2" /><rect x="4" y="13" width="16" height="6" rx="2" /><path d="M8 8h.01M8 16h.01" /></>,
	key: <><circle cx="8.5" cy="14.5" r="4" /><path d="m11.5 11.5 8-8M16.5 6.5l2 2M14.5 8.5l1.5 1.5" /></>,
	sliders: <><path d="M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
} satisfies Record<string, React.ReactNode>;

export type IconName = keyof typeof paths;

export const Icon = ({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) => {
	return (
		<svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
			{paths[name]}
		</svg>
	);
};

export type Tone = 'accent' | 'danger' | 'warning' | 'neutral';

export const StatusPill = ({ tone = 'neutral', children, live = false }: { tone?: Tone; children: React.ReactNode; live?: boolean }) => (
	<span className={`lens-pill lens-pill-${tone}`}>
		<span className={'lens-pill-dot' + (live ? ' lens-pill-dot-live' : '')} aria-hidden="true" />
		{children}
	</span>
);

export const Card = ({ kicker, title, actions, className = '', children, labelledBy }: {
	kicker?: string; title?: React.ReactNode; actions?: React.ReactNode; className?: string; children?: React.ReactNode; labelledBy?: string;
}) => (
	<section className={'lens-card ' + className} aria-labelledby={labelledBy}>
		{(kicker || title || actions) && (
			<div className="lens-card-head">
				<div className="lens-card-titles">
					{kicker && <span className="lens-kicker">{kicker}</span>}
					{title && <h3 id={labelledBy}>{title}</h3>}
				</div>
				{actions && <div className="lens-card-actions">{actions}</div>}
			</div>
		)}
		{children}
	</section>
);

export type MetricState = 'ready' | 'loading' | 'unavailable';

export const Metric = ({ icon, label, value, caption, tone = 'accent', state, action, className = '' }: {
	icon: IconName; label: string; value?: React.ReactNode; caption?: React.ReactNode; tone?: Tone; state: MetricState; action?: React.ReactNode; className?: string;
}) => (
	<article className={`lens-metric lens-metric-${tone} ${className}`} aria-busy={state === 'loading'}>
		<span className="lens-metric-icon"><Icon name={icon} size={20} /></span>
		<div className="lens-metric-body">
			<div className="lens-metric-value">
				{state === 'loading' ? <span className="lens-skeleton" aria-label="Loading" /> : <strong>{state === 'ready' ? value : '—'}</strong>}
			</div>
			<span className="lens-metric-label">{label}</span>
			<small>{state === 'loading' ? 'Retrieving tenant events…' : caption}</small>
			{action}
		</div>
	</article>
);

export const EmptyState = ({ icon = 'sparkle', title, children }: { icon?: IconName; title: string; children?: React.ReactNode }) => (
	<div className="lens-empty">
		<span className="lens-empty-icon"><Icon name={icon} size={20} /></span>
		<strong>{title}</strong>
		{children && <p>{children}</p>}
	</div>
);

export const PageTitle = ({ kicker, title, description, actions }: { kicker?: string; title: string; description?: React.ReactNode; actions?: React.ReactNode }) => (
	<header className="lens-page-title">
		<div>
			{kicker && <span className="lens-kicker">{kicker}</span>}
			<h1>{title}</h1>
			{description && <p>{description}</p>}
		</div>
		{actions && <div className="lens-page-actions">{actions}</div>}
	</header>
);

export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
