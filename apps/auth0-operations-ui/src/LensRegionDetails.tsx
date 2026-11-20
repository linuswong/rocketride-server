import React from 'react';
import type { RegionStats } from './lensGeography';
export function RegionDetails({name, stats, range}: {name:string; stats?:RegionStats; range:string}) {
 return <div className="lens-map-detail"><strong>{name}</strong><span>{range}</span><span>{stats?.accounts ?? 0} identifiable accounts · {stats?.success ?? 0} successful · {stats?.failure ?? 0} failed · {stats?.protection ?? 0} protection events · {stats?.anomalies ?? 0} anomalies</span><small>Account counts exclude events without an account identifier. Network locations are approximate.</small></div>;
}
