// Deterministic server-side authorization model for tests only. No HTTP listener,
// session verifier, durable adapter, concurrency control, or production use.
export class BoundaryHarness {
 constructor(memberships, records) { this.memberships = memberships; this.records = structuredClone(records); }
 authorize(principal, org) {
  if (!principal || !this.memberships.get(principal)?.has(org)) throw new Error('Denied');
 }
 get(principal, org, kind, id) {
  this.authorize(principal, org);
  const record = this.records[kind]?.find(item => item.id === id && item.organizationId === org);
  if (!record) throw new Error('Denied');
  // All child reads also verify their parent, preventing orphan and mismatched links.
  if (kind === 'investigations' || kind === 'drafts') this.get(principal, org, 'tickets', record.ticketId);
  if (kind === 'evidence') this.get(principal, org, 'investigations', record.investigationId);
  return structuredClone(record);
 }
 listTickets(principal, org) { this.authorize(principal, org); return structuredClone(this.records.tickets.filter(item => item.organizationId === org)); }
 link(principal, org, ticketId, investigationId) {
  const ticket = this.get(principal, org, 'tickets', ticketId);
  const investigation = this.get(principal, org, 'investigations', investigationId);
  if (investigation.ticketId !== ticket.id) throw new Error('Denied');
  return investigation;
 }
 updateStatus(principal, org, id, status, version) {
  const ticket = this.get(principal, org, 'tickets', id);
  if (!['new', 'triaged', 'investigating', 'awaiting_review', 'resolved', 'escalated'].includes(status)) throw new Error('Invalid status');
  if (ticket.version !== version) throw new Error('Conflict');
  const stored = this.records.tickets.find(item => item.id === id && item.organizationId === org);
  stored.status = status; stored.version++;
  return structuredClone(stored);
 }
}
