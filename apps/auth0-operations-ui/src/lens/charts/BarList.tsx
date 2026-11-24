import React from 'react';
import type { Tone } from '../ui';

export type BarItem = { label: string; value: number; tone?: Tone; meta?: string };

export const BarList = ({ items, label }: { items: BarItem[]; label: string }) => {
	const max = Math.max(1, ...items.map((item) => item.value));
	return (
		<ul className="lens-barlist" aria-label={label}>
			{items.map((item) => (
				<li key={item.label}>
					<div className="lens-barlist-row">
						<span>{item.label}</span>
						<strong>{item.value}</strong>
					</div>
					<div className="lens-barlist-track" aria-hidden="true">
						<span className={`lens-barlist-fill lens-tone-${item.tone ?? 'accent'}`} style={{ width: `${(item.value / max) * 100}%` }} />
					</div>
					{item.meta && <small>{item.meta}</small>}
				</li>
			))}
		</ul>
	);
};
