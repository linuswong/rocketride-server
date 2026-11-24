import React from 'react';
import { Icon, StatusPill } from './ui';
import type { LensView } from './types';

export type HeaderControls = {
	setHours: (hours: number) => void;
	application: string;
	setApplication: (app: string) => void;
	applications: string[];
	refresh: () => void;
	coverage: string;
	loadedHours?: number;
	viewDemo: () => void;
};

export const LensHeader = ({ view, controls }: { view: LensView; controls: HeaderControls }) => {
	const { sample, loading, updated, connected, hours, skipped } = view;
	const snapshotLabel = sample ? 'Demo data' : loading ? 'Retrieving…' : updated ? 'Tenant snapshot' : 'Not loaded';
	const rangeExceeded = controls.loadedHours !== undefined && hours > controls.loadedHours;
	return (
		<>
			<div className="lens-toolbar">
				<div className="lens-toolbar-status">
					<StatusPill tone={sample ? 'warning' : updated && !loading ? 'accent' : 'neutral'} live={!sample && !!updated && !loading}>Auth0 · {snapshotLabel}</StatusPill>
					<StatusPill tone={connected ? 'accent' : 'danger'}>{connected ? 'Engine connected' : 'Engine offline'}</StatusPill>
				</div>
				<div className="lens-actions">
					<label className="lens-select">
						<span><Icon name="calendar" size={14} />Date range</span>
						<select value={hours} disabled={loading} onChange={(e) => controls.setHours(Number(e.target.value))}>
							<option value={1}>Last hour</option>
							<option value={24}>Last 24 hours</option>
							<option value={168}>Last 7 days</option>
						</select>
					</label>
					<label className="lens-select">
						<span><Icon name="filter" size={14} />Application</span>
						<select value={controls.application} onChange={(e) => controls.setApplication(e.target.value)}>
							<option value="">All applications</option>
							{controls.applications.map((name) => <option key={name} value={name}>{name}</option>)}
						</select>
					</label>
					<button className="primary" disabled={!connected || loading} onClick={controls.refresh}>
						<Icon name="refresh" size={16} />
						{loading ? 'Loading…' : 'Load tenant events'}
					</button>
				</div>
			</div>
			<div className="lens-notice" role="status">
				{sample ? 'Demo · synthetic authentication activity' : loading ? 'Retrieving tenant events…' : updated ? 'Tenant snapshot · ' + new Date(updated).toISOString() : 'Tenant snapshot unavailable'} · {connected ? 'Engine connected' : 'Engine offline'}
				{!sample && (
					<>
						{' '}· {controls.coverage || 'No history loaded'} · {skipped} excluded from sign-in analytics
						{rangeExceeded && ' · Selected range exceeds loaded history. Reload to retrieve it.'}{' '}
						<button className="lens-link" disabled={loading} onClick={controls.viewDemo}>View demo</button>
					</>
				)}
			</div>
			{!sample && updated && (
				<p className="lens-foot lens-caveat">
					Historical spike and rate comparisons are unavailable because tenant retention and search completeness have not been independently verified. Geographic and source concentrations describe only the retrieved window.
				</p>
			)}
		</>
	);
};
