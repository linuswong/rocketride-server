export const origins = [
	{ name: 'San Francisco', lon: -122.4, lat: 37.8, successes: 48, failures: 3 },
	{ name: 'São Paulo', lon: -46.6, lat: -23.6, successes: 21, failures: 2 },
	{ name: 'London', lon: -0.1, lat: 51.5, successes: 64, failures: 5 },
	{ name: 'Singapore', lon: 103.8, lat: 1.35, successes: 32, failures: 8 },
	{ name: 'Sydney', lon: 151.2, lat: -33.9, successes: 27, failures: 1 },
	{ name: 'Seattle', lon: -122.33, lat: 47.61, successes: 32, failures: 0 },
	{ name: 'Los Angeles', lon: -118.24, lat: 34.05, successes: 36, failures: 0 },
	{ name: 'New York', lon: -74.01, lat: 40.71, successes: 40, failures: 0 },
	{ name: 'Toronto', lon: -79.38, lat: 43.65, successes: 28, failures: 0 },
	{ name: 'Mexico City', lon: -99.13, lat: 19.43, successes: 24, failures: 0 },
	{ name: 'Bogotá', lon: -74.07, lat: 4.71, successes: 22, failures: 0 },
	{ name: 'Buenos Aires', lon: -58.38, lat: -34.60, successes: 25, failures: 0 },
	{ name: 'Paris', lon: 2.35, lat: 48.86, successes: 34, failures: 0 },
	{ name: 'Berlin', lon: 13.40, lat: 52.52, successes: 30, failures: 0 },
	{ name: 'Amsterdam', lon: 4.90, lat: 52.37, successes: 25, failures: 0 },
	{ name: 'Stockholm', lon: 18.07, lat: 59.33, successes: 20, failures: 0 },
	{ name: 'Johannesburg', lon: 28.05, lat: -26.20, successes: 22, failures: 0 },
	{ name: 'Dubai', lon: 55.27, lat: 25.20, successes: 26, failures: 0 },
	{ name: 'Mumbai', lon: 72.88, lat: 19.08, successes: 34, failures: 0 },
	{ name: 'Tokyo', lon: 139.69, lat: 35.68, successes: 38, failures: 0 },
	{ name: 'Auckland', lon: 174.76, lat: -36.85, successes: 20, failures: 0 },
];
export function exampleEvents(now: number) {
	return origins.flatMap(({ name, lon, lat, successes, failures }, site) =>
		Array.from({ length: successes + failures }, (_, i) => ({
			id: name + i,
			time: now - (i < failures ? i * 78000 + site * 123000 : (i * 1731239) % 86400000),
			kind: i < failures ? ('failure' as const) : ('success' as const),
			category: i < failures ? 'Wrong password' : 'Successful login',
			app: 'Example application',
			origin: { lon, lat, label: name },
			account: site >= 5 ? 1000 + site * 100 + i : site === 2 ? 80 : i + 1,
			source: site + 1,
		}))
	);
}

/** Synthetic inventory shares account groups with the example login events. */
export function exampleInventory(now: number) {
 const events = exampleEvents(now);
 const observed = new Set(events.map(event => event.account));
 const active = new Set(events.filter(event => event.kind === 'success').map(event => event.account));
 const inactive = 14;
 const unknown = observed.size - active.size + 3;
 return { status: 'complete' as const, total: active.size + inactive + unknown, active: active.size, inactive, unknown, checkedAt: now };
}
