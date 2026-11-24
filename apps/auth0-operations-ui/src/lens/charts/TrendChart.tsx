import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import type { summarize } from '../../loginLensAnalytics';

type Buckets = ReturnType<typeof summarize>['buckets'];
type Point = [number, number];

const X_AXIS_HEIGHT = 28;
const TOP_PADDING = 10;
const series = [
	{ key: 'success', label: 'Successful', className: 'lens-series-success' },
	{ key: 'failure', label: 'Failed', className: 'lens-series-failure' },
] as const;

// Monotone cubic interpolation keeps the curve from overshooting below zero or past a peak.
const monotonePath = (points: Point[]) => {
	if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : '';
	const slopes = points.slice(1).map(([x, y], i) => (y - points[i][1]) / (x - points[i][0]));
	const tangents = points.map((_, i) =>
		i === 0 ? slopes[0] : i === points.length - 1 ? slopes[i - 1] : slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2
	);
	slopes.forEach((slope, i) => {
		if (slope === 0) { tangents[i] = 0; tangents[i + 1] = 0; return; }
		const a = tangents[i] / slope, b = tangents[i + 1] / slope, sum = a * a + b * b;
		if (sum <= 9) return;
		const tau = 3 / Math.sqrt(sum);
		tangents[i] = tau * a * slope;
		tangents[i + 1] = tau * b * slope;
	});
	return points.reduce((path, [x, y], i) => {
		if (i === 0) return `M${x},${y}`;
		const [px, py] = points[i - 1], dx = (x - px) / 3;
		return `${path} C${px + dx},${py + tangents[i - 1] * dx} ${x - dx},${y - tangents[i] * dx} ${x},${y}`;
	}, '');
};

const useElementSize = () => {
	const ref = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return { ref, ...size };
};

export function TrendChart({ buckets, hours }: { buckets: Buckets; hours: number }) {
	const [selected, select] = useState<number>();
	const gradientId = useId().replace(/:/g, '');
	const { ref, width, height } = useElementSize();
	const step = Math.max(1, Math.ceil(Math.max(...buckets.map((b) => Math.max(b.success, b.failure))) / 4));
	const max = step * 4;
	const plotHeight = Math.max(0, height - X_AXIS_HEIGHT);
	const x = (i: number) => ((i + 0.5) * width) / buckets.length;
	const y = (count: number) => TOP_PADDING + (1 - count / max) * (plotHeight - TOP_PADDING);
	const value = selected === undefined ? undefined : buckets[selected];
	const stampLabel = (start: number) => new Date(start).toISOString().slice(hours > 24 ? 5 : 11, hours > 24 ? 10 : 16);
	return (
		<div className="lens-trend">
			<div className="lens-trend-legend" aria-hidden="true">
				{series.map((s) => <span key={s.key} className={s.className}><i />{s.label}</span>)}
			</div>
			<div className="lens-trend-frame">
				<div className="lens-trend-axis" aria-hidden="true">
					{plotHeight > 0 && [4, 3, 2, 1, 0].map((n) => <span key={n} style={{ top: y(n * step) }}>{n * step}</span>)}
				</div>
				<div ref={ref} className="trend-plot" aria-label="Sign-ins by time bucket" onPointerLeave={() => select(undefined)}>
					{width > 0 && plotHeight > 0 && (
						<svg width={width} height={plotHeight} aria-hidden="true">
							<defs>
								{series.map((s) => (
									<linearGradient key={s.key} id={`${gradientId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" className={`${s.className} lens-stop-top`} />
										<stop offset="100%" className={`${s.className} lens-stop-bottom`} />
									</linearGradient>
								))}
							</defs>
							{[0, 1, 2, 3, 4].map((n) => <line key={n} className="lens-trend-grid" x1="0" x2={width} y1={y(n * step)} y2={y(n * step)} />)}
							{series.map((s) => {
								const points = buckets.map((b, i): Point => [x(i), y(b[s.key])]);
								const line = monotonePath(points);
								return (
									<g key={s.key} className={s.className}>
										<path className="lens-trend-area" d={`${line} L${x(buckets.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${gradientId}-${s.key})`} />
										<path className="lens-trend-line" d={line} />
									</g>
								);
							})}
							{value && selected !== undefined && (
								<g>
									<line className="lens-trend-guide" x1={x(selected)} x2={x(selected)} y1={TOP_PADDING} y2={y(0)} />
									{series.map((s) => <circle key={s.key} className={`lens-trend-dot ${s.className}`} cx={x(selected)} cy={y(value[s.key])} r="4" />)}
								</g>
							)}
						</svg>
					)}
					{value && selected !== undefined && width > 0 && (
						<div className={'lens-trend-tooltip' + (selected >= buckets.length / 2 ? ' lens-trend-tooltip-left' : '')} style={{ left: x(selected) }} aria-hidden="true">
							<strong>{stampLabel(value.start)} UTC</strong>
							<span className="lens-series-success"><i />{value.success} successful</span>
							<span className="lens-series-failure"><i />{value.failure} failed</span>
						</div>
					)}
					<div className="trend-hit-areas">
						{buckets.map((b, i) => {
							const stamp = new Date(b.start).toISOString();
							return (
								<button
									className="lens-bar-col"
									key={b.start}
									aria-pressed={selected === i}
									aria-label={`${stamp}: ${b.success} successful, ${b.failure} failed`}
									onClick={() => select(i)}
									onFocus={() => select(i)}
									onPointerEnter={() => select(i)}
								>
									<small>{stampLabel(b.start)}</small>
								</button>
							);
						})}
					</div>
				</div>
			</div>
			<p className="lens-trend-caption" role="status">
				{value ? new Date(value.start).toISOString() + ' · ' : 'Per time bucket · '}
				<span className="lens-series-success"><i /></span> {value?.success} Successful &nbsp;{' '}
				<span className="lens-series-failure"><i /></span> {value?.failure} Failed
			</p>
		</div>
	);
}
