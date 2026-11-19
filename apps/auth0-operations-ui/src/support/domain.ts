export type TicketStatus = 'new' | 'triaged' | 'investigating' | 'awaiting_review' | 'resolved' | 'escalated';
export type TicketPriority = 'low' | 'normal' | 'high';
export type TicketCategory = 'authentication' | 'billing' | 'technical' | 'general' | 'other';
export type Route = 'auth0' | 'knowledge' | 'human';
export interface Customer { email: string }
export interface TicketEvent { at: string; description: string }
export interface InvestigationReference { id: string; ticketId: string; mode: 'fictional'; summary: string[] }
export interface Triage { category: TicketCategory; priority: TicketPriority; route: Route; reasoning: string; uncertainty: string; escalate: boolean }
export interface Ticket { id: string; organizationId: string; customer: Customer; subject: string; description: string; category: TicketCategory; priority: TicketPriority; status: TicketStatus; createdAt: string; updatedAt: string; events: TicketEvent[]; triage?: Triage; investigations: InvestigationReference[] }
export interface NewTicket { email: string; subject: string; description: string }
export const transitions: Record<TicketStatus, TicketStatus[]> = { new:['triaged','escalated'], triaged:['investigating','awaiting_review','escalated'], investigating:['awaiting_review','escalated'], awaiting_review:['resolved','investigating','escalated'], resolved:['new'], escalated:['triaged','investigating','awaiting_review','resolved'] };
export function validateNewTicket(value: unknown): NewTicket {
 if (!value || typeof value !== 'object') throw new Error('Ticket details are required.');
 const item = value as Record<string,unknown>;
 if (typeof item.email !== 'string' || typeof item.subject !== 'string' || typeof item.description !== 'string') throw new Error('Complete all ticket fields.');
 const email = item.email.trim(), subject = item.subject.trim(), description = item.description.trim();
 if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid fictional customer email.');
 if (!subject || subject.length > 160 || !description || description.length > 4000) throw new Error('Enter a subject (up to 160 characters) and description (up to 4000 characters).');
 return {email,subject,description};
}
export function canTransition(from: TicketStatus, to: string): to is TicketStatus { return transitions[from]?.includes(to as TicketStatus) ?? false; }
export function filterTickets(tickets:Ticket[], query:string, status:string):Ticket[] {
 const term=query.trim().toLowerCase();
 return tickets.filter(ticket=>(status==='all'||ticket.status===status) && `${ticket.subject} ${ticket.customer.email} ${ticket.description}`.toLowerCase().includes(term));
}
