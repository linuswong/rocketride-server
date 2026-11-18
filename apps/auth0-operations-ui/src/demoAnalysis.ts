/** Deterministic local fixture analysis. No API, model, or authentication calls. */
export interface DemoUser { email: string; name: string; email_verified: boolean; blocked: boolean; role: string; }
export interface DemoEvent { date: string; type: string; description: string; synthetic: boolean; }
export interface DemoCase { id: string; email: string; scenario: string; events: DemoEvent[]; expected_finding: string; }
export interface DemoResult {
 email: string; profile?: DemoUser; events: (DemoEvent & { caseId: string })[];
 hasProtectionBlock: boolean;
}

export function investigateDemo(email: string, users: DemoUser[], cases: DemoCase[]): DemoResult {
 const address = email.trim().toLowerCase();
 const profile = users.find(user => user.email.toLowerCase() === address);
 const matches = cases.filter(item => item.email.toLowerCase() === address);
 const events = matches.flatMap(item => item.events.map(event => ({ ...event, caseId: item.id })))
  .sort((a, b) => b.date.localeCompare(a.date));
 const hasProtectionBlock = matches.some(item => item.scenario === 'brute_force_protection');
 return { email: address, profile, events, hasProtectionBlock };
}
