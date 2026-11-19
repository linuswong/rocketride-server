// Isolated test host: no shell, engine, credentials or network integration.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InvestigationWorkspace } from '../../src/InvestigationWorkspace';
import { demoClient } from '../../src/offlineDemo';
import { SupportPlatform, type SupportPage } from '../../src/SupportPlatform';
import '../../src/styles.css';

function Fixture() {
 const [busy, setBusy] = useState(false);
 const [page, setPage] = useState<SupportPage>('Dashboard');
 if (new URLSearchParams(location.search).has('support')) return <main className="app"><nav>{(['Dashboard','Support Inbox','Investigations','Integrations','Settings'] as SupportPage[]).map(item=><button key={item} onClick={()=>setPage(item)}>{item}</button>)}</nav><SupportPlatform page={page} navigate={setPage}/></main>;
 const slow = new URLSearchParams(location.search).has('slow');
 return <main className="app"><InvestigationWorkspace active client={{tool: async options => { await new Promise(resolve => setTimeout(resolve, 250)); return demoClient.tool(options); }}} connected start={async () => { if (!slow) throw new Error('sensitive startup detail'); return 'fixture'; }} analyze={async () => 'Fixture interpretation from the configured analyzer.'} busy={busy} setBusy={setBusy} /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
