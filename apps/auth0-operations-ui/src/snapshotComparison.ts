import { mfaSignalLabel, otherEvents, type Event, type OtherEvent } from './loginLensAnalytics.ts';

export type Snapshot = {start:number; end:number; ids:Set<string>; failures:Event[]; mfa:OtherEvent[]};

/** Compare only overlapping, successfully retrieved windows; an unseen ID is not proof of a new incident. */
export type SnapshotComparison = {ids:string[]; mfaIds:string[]; previousEnd:number};
export function compareSnapshots(previous: Snapshot | undefined, current: Snapshot): SnapshotComparison | undefined {
 if (!previous || current.start < previous.start || current.end <= previous.end || current.start > previous.end) return;
 const ids = current.failures.filter(event => event.time >= current.start && event.time <= current.end && !previous.ids.has(event.id)).map(event => event.id);
 const mfaIds = current.mfa.filter(event => event.time >= current.start && event.time <= current.end && !previous.ids.has(event.id)).map(event => event.id);
 return {ids:[...new Set(ids)],mfaIds:[...new Set(mfaIds)],previousEnd:previous.end};
}

export function makeSnapshot(rows: unknown[], events: Event[], start: number, end: number): Snapshot {
 const ids = new Set(rows.flatMap(row => row && typeof row === 'object' && typeof (row as Record<string,unknown>).log_id === 'string' && (row as Record<string,string>).log_id ? [(row as Record<string,string>).log_id] : []));
 return {start,end,ids,failures:events.filter(event => event.kind === 'failure'),mfa:otherEvents(rows).filter(event => !!mfaSignalLabel(event.type))};
}

/** Keep unreviewed markers only while their events remain in comparable returned snapshots. */
export function pendingAfterSnapshot(previousIds: readonly string[], comparison: {ids:string[]; mfaIds:string[]} | undefined, current: Snapshot): string[] {
 if (!comparison) return [];
 const available = new Set([...current.failures,...current.mfa].map(event => event.id));
 return [...new Set([...previousIds,...comparison.ids,...comparison.mfaIds])].filter(id => available.has(id));
}
