import { canTransition, validateNewTicket, type Ticket, type TicketStatus, type InvestigationReference } from './domain.ts';
import { triageTicket } from './workflows.ts';

export interface TicketRepository {
 list(scope:string): Ticket[];
 get(scope:string,id:string): Ticket;
 create(scope:string,input:unknown): Ticket;
 triage(scope:string,id:string): Ticket;
 transition(scope:string,id:string,status:TicketStatus): Ticket;
 linkDemo(scope:string,id:string,reference:InvestigationReference): Ticket;
}
/** Scope checks prevent accidental cross-scope use; this is not a security boundary against browser users. */
export class MemoryTicketRepository implements TicketRepository {
 private records = new Map<string,Ticket>();
 private readonly organizationId:string;
 constructor(organizationId:string) { if (!organizationId.trim()) throw new Error('Organization scope is required.'); this.organizationId=organizationId; }
 private check(scope:string) { if (scope !== this.organizationId) throw new Error('Access denied.'); }
 private copy<T>(value:T):T { return structuredClone(value); }
 list(scope:string) { this.check(scope); return this.copy([...this.records.values()]); }
 get(scope:string,id:string) { this.check(scope); const ticket=this.records.get(id); if (!ticket) throw new Error('Ticket not found.'); return this.copy(ticket); }
 private save(ticket:Ticket, message:string) { const at=new Date().toISOString(); ticket.updatedAt=at; ticket.events.push({at,description:message}); this.records.set(ticket.id,ticket); return this.copy(ticket); }
 create(scope:string,input:unknown) { this.check(scope); const data=validateNewTicket(input), at=new Date().toISOString(); const ticket:Ticket={id:crypto.randomUUID(),organizationId:scope,customer:{email:data.email},subject:data.subject,description:data.description,category:'other',priority:'normal',status:'new',createdAt:at,updatedAt:at,events:[{at,description:'Fictional ticket created.'}],investigations:[]}; this.records.set(ticket.id,ticket); return this.copy(ticket); }
 triage(scope:string,id:string) { const ticket=this.get(scope,id); if (!canTransition(ticket.status,'triaged')) throw new Error('Ticket cannot be triaged from its current status.'); const result=triageTicket({email:ticket.customer.email,subject:ticket.subject,description:ticket.description}); ticket.triage=result; ticket.category=result.category; ticket.priority=result.priority; ticket.status='triaged'; return this.save(ticket,'Offline classification completed.'); }
 transition(scope:string,id:string,status:TicketStatus) { const ticket=this.get(scope,id); if (!canTransition(ticket.status,status)) throw new Error('Invalid ticket status transition.'); ticket.status=status; return this.save(ticket,`Status changed to ${status}.`); }
 linkDemo(scope:string,id:string,reference:InvestigationReference) { const ticket=this.get(scope,id); if (!reference || typeof reference !== 'object' || ticket.status !== 'investigating' || ticket.category !== 'authentication' || ticket.customer.email.toLowerCase() !== 'alex@example.com' || reference.ticketId !== ticket.id || reference.mode !== 'fictional' || typeof reference.id !== 'string' || !reference.id || !Array.isArray(reference.summary) || !reference.summary.every(x=>typeof x === 'string' && x.length <= 300)) throw new Error('The fictional investigation cannot be linked to this ticket.'); if ([...this.records.values()].some(record=>record.investigations.some(x=>x.id===reference.id))) throw new Error('Investigation already linked.'); ticket.investigations.push(this.copy(reference)); return this.save(ticket,'Fictional investigation linked.'); }
}
