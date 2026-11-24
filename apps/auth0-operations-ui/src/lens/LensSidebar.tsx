import React from 'react';
import { Icon } from './ui';
import { lensPages, pageIcons, type LensPage } from './pages';

export const LensSidebar = ({ page, navigate, alertCount }: { page: LensPage; navigate: (page: LensPage) => void; alertCount: number | null }) => (
	<nav className="nav lens-nav" aria-label="LoginLens navigation">
		<div className="nav-group">
			{lensPages.map((item) => {
				// The badge is CSS-generated so the button text stays the page name.
				const badge = item === 'Alerts' && alertCount ? String(alertCount) : undefined;
				return (
					<button
						key={item}
						className="nav-item"
						aria-current={page === item ? 'page' : undefined}
						aria-label={badge ? `${item}, ${badge} detected ${alertCount === 1 ? 'anomaly' : 'anomalies'}` : undefined}
						data-count={badge}
						onClick={() => navigate(item)}
					>
						<Icon name={pageIcons[item]} />
						{item}
					</button>
				);
			})}
		</div>
		<div className="nav-note">
			<Icon name="shield" size={16} />
			<span>Read-only workspace<small>Auth0 access is read-only.</small></span>
		</div>
	</nav>
);
