/** Resolve a minute-precision wall time in the selected IANA timezone. */
export function localIncidentCandidates(value: string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string[] {
 if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !timeZone || timeZone.length > 100) return [];
 const naive = Date.parse(`${value}:00.000Z`);
 if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0,16) !== value) return [];
 let formatter: Intl.DateTimeFormat;
 try {
  formatter = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 } catch { return []; }
 const wallTime = (epoch: number) => {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(epoch)).map(part => [part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
 };
 const offsets = new Set<number>();
 // Inspect offsets on both sides of nearby clock transitions, including half-hour shifts.
 for (let hour = -48; hour <= 48; hour += 3) {
  const sample = naive + hour*3600000;
  const asUtc = Date.parse(`${wallTime(sample)}:00.000Z`);
  if (Number.isFinite(asUtc)) offsets.add(asUtc-sample);
 }
 const candidates = [...offsets].map(offset => naive-offset)
  .filter(epoch => wallTime(epoch) === value)
  .map(epoch => new Date(epoch).toISOString());
 return [...new Set(candidates)].sort();
}

export function supportedTimeZones(): string[] {
 const getZones = (Intl as typeof Intl & {supportedValuesOf?: (key: 'timeZone') => string[]}).supportedValuesOf;
 try { return getZones ? getZones('timeZone') : []; } catch { return []; }
}

export function validTimeZone(value: string): boolean {
 if (!value || value.length > 100) return false;
 try { new Intl.DateTimeFormat('en',{timeZone:value}); return true; } catch { return false; }
}
