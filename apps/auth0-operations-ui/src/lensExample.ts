export const origins = [
 { name: 'San Francisco', lon: -122.4, lat: 37.8, successes: 48, failures: 3 },
 { name: 'São Paulo', lon: -46.6, lat: -23.6, successes: 21, failures: 2 },
 { name: 'London', lon: -.1, lat: 51.5, successes: 64, failures: 5 },
 { name: 'Singapore', lon: 103.8, lat: 1.35, successes: 32, failures: 8 },
 { name: 'Sydney', lon: 151.2, lat: -33.9, successes: 27, failures: 1 },
];
export function exampleEvents(now: number) {
 return origins.flatMap(({ name, successes, failures }) =>
  Array.from({ length: successes + failures }, (_, i) => ({
   id: name + i, time: now - (i * 1731239) % 86400000,
   kind: i < failures ? 'failure' as const : 'success' as const,
   category: i < failures ? 'Wrong password' : 'Successful login', app: name,
  }))
 );
}
