import React, { useState } from 'react';
import fixture from './demo/investigations.synthetic.json';
import users from './demo/users.json';
import { investigateDemo, type DemoResult } from './demoAnalysis';

/** This view is intentionally self-contained and cannot call the engine or Auth0. */
export function DemoInvestigation({ analyze, connected, busy }: { analyze: (question: string, evidence: DemoResult) => Promise<string>; connected: boolean; busy: boolean }): React.ReactElement {
 const [email, setEmail] = useState('avery.cole@example.com');
 const [result, setResult] = useState<DemoResult | null>(null);
 const [question, setQuestion] = useState('Investigate the sign-in issue and explain the evidence and next steps.');
 const [answer, setAnswer] = useState('');
 const [error, setError] = useState('');
 const choices = [...new Set([...users.map(user => user.email), ...fixture.investigations.map(item => item.email)])];
 const run = async () => {
  if (busy || !connected || !question.trim()) return;
  const evidence = investigateDemo(email, users, fixture.investigations);
  setResult(evidence); setAnswer(''); setError('');
  try { setAnswer(await analyze(question, evidence)); }
  catch (err) { setError(err instanceof Error ? err.message : 'Synthetic investigation failed.'); }
 };
 const lastLogin = result?.events.find(event => event.type === 's');
 return <>
  <div className="banner demo-banner" role="status"><strong>SYNTHETIC DEMO MODE</strong> · Evidence is fictional. The question and selected fixture are sent through RocketRide to the configured model provider for analysis. Auth0 is not queried.</div>
  <div className="panel demo-panel"><span className="eyebrow">SIMULATED SIGN-IN HELPDESK</span><h2>Investigate a fictional user</h2>
   <p>Ask a question about an account. The AI will analyze its synthetic profile, login events, and protection fixture.</p>
   <form onSubmit={event => { event.preventDefault(); void run(); }}><label htmlFor="demo-email">User email</label><div className="row"><input id="demo-email" type="email" list="demo-accounts" required disabled={busy} value={email} onChange={event => setEmail(event.target.value)} /><datalist id="demo-accounts">{choices.map(choice => <option value={choice} key={choice}/>)}</datalist></div><label htmlFor="demo-question" className="demo-question-label">Investigation question</label><div className="row"><input id="demo-question" required disabled={busy} value={question} onChange={event => setQuestion(event.target.value)} /><button className="primary" disabled={busy || !connected || !question.trim()}>{busy ? 'Investigating…' : 'Run AI investigation →'}</button></div></form>
   {!connected && <p role="alert">Connect to the RocketRide engine to run the synthetic AI investigation.</p>}
   <div className="demo-examples"><strong>Select an example:</strong> {fixture.investigations.map(item => <button type="button" disabled={busy} key={item.id} onClick={() => { setEmail(item.email); setResult(null); setAnswer(''); setError(''); }}>{item.scenario.replace(/_/g, ' ')}</button>)}</div>
  </div>
  {!result ? <div className="panel demo-timeline"><p>Choose an example or enter an email, then run the investigation to see the simulated findings and evidence.</p></div> : <div aria-live="polite">
   <section className="panel demo-timeline"><span className="eyebrow">AI ANALYSIS · SYNTHETIC DATA</span><h2>Investigation for {result.email}</h2>{busy && <p>Analyzing the synthetic evidence…</p>}{error && <p role="alert">{error}</p>}{answer && <div className="demo-answer">{answer}</div>}<p className="hint">AI output is unverified; compare it with the fictional evidence below. No recovery action was performed.</p></section>
   <div className="grid demo-results"><article><span className="eyebrow">SYNTHETIC ACCOUNT EVIDENCE</span><h3>{result.profile?.name ?? 'No fixture profile'}</h3><p>{result.email}</p>{result.profile && <><p>Email verified: {result.profile.email_verified ? 'Yes' : 'No'}<br/>Administrative block: {result.profile.blocked ? 'Yes' : 'No'}<br/>Role label: {result.profile.role} (not a real role assignment)</p><p>Last simulated successful login: {lastLogin ? lastLogin.date : 'None in this fixture'}</p></>}</article>
    <article><span className="eyebrow">SYNTHETIC PROTECTION EVIDENCE</span><h3>{result.hasProtectionBlock ? 'Simulated brute-force block' : 'No simulated brute-force block'}</h3><p>Separate from the administrative block in the fictional profile. This is not an Auth0 block lookup.</p></article>
   </div>
   <section className="panel demo-timeline"><span className="eyebrow">SYNTHETIC EVENT EVIDENCE · UTC</span><h2>Login history</h2>
    {result.events.length === 0 ? <p>No simulated events for this email. This does not describe the real account.</p> : <ol>{result.events.map((event, index) => <li key={`${event.caseId}-${index}`}><div><strong>{event.description}</strong><span className="demo-tag">SYNTHETIC</span></div><p>{event.date} · {event.type} · {event.caseId}</p></li>)}</ol>}
    <p className="hint">Codes beginning with synthetic_ are illustrative placeholders, not Auth0 log types. Fictional timestamps do not establish real sign-ins.</p>
   </section>
  </div>}
 </>;
}
