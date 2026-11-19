import React from 'react';
import type { Evidence } from './operations';

function label(key: string): string {
 return key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, character => character.toUpperCase());
}

export function Value({ value }: { value: unknown }): React.ReactElement {
 if (value === null) return <span className="data-empty">Not provided (null)</span>;
 if (Array.isArray(value)) {
  if (!value.length) return <span className="data-empty">None</span>;
  return <ol className="data-list">{value.map((item, index) => <li key={index}><Value value={item} /></li>)}</ol>;
 }
 if (typeof value === 'object') {
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return <span className="data-empty">Empty object</span>;
  return <dl className="data-fields">{entries.map(([key, item]) => <div className="data-field" key={key}><dt title={key}>{label(key)}</dt><dd><Value value={item} /></dd></div>)}</dl>;
 }
 if (typeof value === 'boolean') return <span>{value ? 'Yes (true)' : 'No (false)'}</span>;
 if (value === '') return <span className="data-empty">Empty string</span>;
 return <span>{String(value)}</span>;
}

export function EvidenceCard({ item }: { item: Evidence }): React.ReactElement {
 return <section className="evidence">
  <div className="evidence-heading"><strong>{label(item.tool)}</strong><span className={'evidence-status ' + item.status}>{item.status === 'success' ? 'Retrieved' : 'Failed'}</span></div>
  <span className="tool-name">{item.tool}</span>
  {item.input && Object.keys(item.input).length > 0 && <div className="data-section"><h4>Request</h4><Value value={item.input} /></div>}
  {item.error && <p role="alert">{item.error}</p>}
  {item.data !== undefined && <><div className="data-section"><h4>Response</h4><Value value={item.data} /></div><details className="raw-json"><summary>View raw JSON</summary><pre>{JSON.stringify(item.data, null, 2)}</pre></details></>}
 </section>;
}
