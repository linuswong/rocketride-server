import React, { useState } from 'react';
import type { summarize } from './loginLensAnalytics';

export function LensTrend({
	buckets,
	hours,
}: {
	buckets: ReturnType<typeof summarize>['buckets'];
	hours: number;
}) {
	const [selected, select] = useState<number>();
	const max = Math.max(1, ...buckets.map((b) => Math.max(b.success, b.failure)));
	const value = selected === undefined ? undefined : buckets[selected];
	const point = (i: number, count: number) =>
		`${((i + 0.5) * 100) / buckets.length},${98 - (count / max) * 94}`;
	return (
		<>
			<div className="trend-plot" aria-label="Sign-ins by time bucket">
				<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
					{[0, 0.5, 1].map((n) => (
						<line
							key={n}
							x1="0"
							x2="100"
							y1={98 - n * 94}
							y2={98 - n * 94}
							stroke="var(--rr-border, #dce2e9)"
							vectorEffect="non-scaling-stroke"
						/>
					))}
					{(['success', 'failure'] as const).map((series) => {
						const path = buckets.map((b, i) => point(i, b[series])).join(' ');
						const color = series === 'success' ? 'var(--rr-color-success, #16834f)' : 'var(--rr-color-error, #b42318)';
						return (
							<g key={series}>
								<polygon
									points={point(0, 0) + ' ' + path + ' ' + point(buckets.length - 1, 0)}
									fill={color}
									opacity=".08"
								/>
								<polyline
									points={path}
									fill="none"
									stroke={color}
									strokeWidth="2"
									vectorEffect="non-scaling-stroke"
								/>
							</g>
						);
					})}
				</svg>
				<div className="trend-hit-areas">
					{buckets.map((b, i) => {
						const stamp = new Date(b.start).toISOString();
						return (
							<button
								className="lens-bar-col"
								key={b.start}
								aria-pressed={selected === i}
								aria-label={`${stamp}: ${b.success} successful, ${b.failure} failed`}
								title={`${stamp} · ${b.success} successful · ${b.failure} failed`}
								onClick={() => select(i)}
								onFocus={() => select(i)}
								onPointerEnter={() => select(i)}
							>
								<small>{stamp.slice(hours > 24 ? 5 : 11, hours > 24 ? 10 : 16)}</small>
							</button>
						);
					})}
				</div>
			</div>
			<p className="lens-trend-caption" role="status">
				{value ? new Date(value.start).toISOString() + ' · ' : 'Per time bucket · '}
				<span className="lens-blue">●</span> {value?.success} Successful &nbsp;{' '}
				<span className="lens-orange">●</span> {value?.failure} Failed
			</p>
		</>
	);
}
