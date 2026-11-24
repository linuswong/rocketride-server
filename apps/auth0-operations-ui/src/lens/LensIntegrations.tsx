import React from 'react';
import { thresholds } from '../lensRules';
import { Card, Icon, PageTitle, StatusPill, type IconName, type Tone } from './ui';
import type { LensView } from './types';

const Integration = ({ icon, name, status, tone, children }: { icon: IconName; name: string; status: string; tone: Tone; children: React.ReactNode }) => (
	<section className="lens-card lens-integration">
		<div className="lens-integration-head">
			<span className="lens-metric-icon"><Icon name={icon} size={20} /></span>
			<h3>{name}</h3>
			<StatusPill tone={tone}>{status}</StatusPill>
		</div>
		{children}
	</section>
);

export const LensIntegrations = ({ view }: { view: LensView }) => {
	const auth0 = view.sample ? { status: 'Demo data', tone: 'warning' as const } : view.updated ? { status: 'Snapshot loaded', tone: 'accent' as const } : { status: 'Not loaded', tone: 'neutral' as const };
	return (
		<>
			<PageTitle kicker="INTEGRATIONS" title="Integrations" description="Services LoginLens uses. Credentials, tenant permissions and providers are configured in the RocketRide engine." />
			<div className="lens-grid lens-grid-3">
				<Integration icon="engine" name="RocketRide engine" status={view.connected ? 'Connected' : 'Disconnected'} tone={view.connected ? 'accent' : 'danger'}>
					<p>RocketRide engine: {view.connected ? 'Connected' : 'Disconnected'}. Runs the Auth0 telemetry and investigation pipelines.</p>
				</Integration>
				<Integration icon="key" name="Auth0" status={auth0.status} tone={auth0.tone}>
					<p>Auth0 access: read-only. Configure credentials and tenant permissions in the RocketRide engine.</p>
				</Integration>
				<Integration icon="sparkle" name="Gemini" status="Not verified" tone="neutral">
					<p>AI provider: Gemini, configured in the RocketRide pipeline. Availability is checked when an analysis is requested.</p>
				</Integration>
				<Integration icon="investigations" name="Jira Service Management" status="Not connected" tone="neutral">
					<p>A Jira request key can be recorded in a handoff, but LoginLens does not retrieve or update Jira cases. An experimental Jira Cloud node exists in the source checkout; availability in RocketRide Cloud has not been verified.</p>
				</Integration>
			</div>
			<Card kicker="RULE-BASED DETECTION" title="Detection thresholds" className="lens-thresholds">
				<dl>
					<div><dt>Repeated failures</dt><dd>{thresholds.repeated} in {thresholds.minutes} minutes</dd></div>
					<div><dt>Possible spraying</dt><dd>{thresholds.accounts} accounts</dd></div>
					<div><dt>Failure spike</dt><dd>{thresholds.spike} events</dd></div>
					<div><dt>Geographic concentration</dt><dd>{thresholds.geographic} events · {Math.round(thresholds.share * 100)}% share</dd></div>
				</dl>
			</Card>
		</>
	);
};
