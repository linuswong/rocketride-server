// Proposed wire shapes only. Values arriving over a network must be validated by the server.
export interface OrganizationRecord { id: string; configurationRef: string; createdAt: string }
export interface TicketRecord { id: string; organizationId: string; customerRef: string; subject: string; description: string; category: string; priority: string; status: string; createdAt: string; updatedAt: string; version: number }
export interface InvestigationRecord { id: string; organizationId: string; ticketId: string; pipelineRef: string; status: string; startedAt: string; completedAt: string | null }
export interface EvidenceRecord { id: string; organizationId: string; investigationId: string; sourceTool: string; sanitizedOutputRef: string; classification: string; collectedAt: string }
export interface DraftRecord { id: string; organizationId: string; ticketId: string; content: string; reviewStatus: string; createdAt: string; updatedAt: string }
// IDs select resources, never authorize them. A server derives the principal from its verified session.
export interface ResourceRequest { organizationId: string; id: string }
export interface TicketRepositories {
 listTickets(organizationId: string): Promise<TicketRecord[]>;
 getTicket(request: ResourceRequest): Promise<TicketRecord>;
 getInvestigation(request: ResourceRequest): Promise<InvestigationRecord>;
 getEvidence(request: ResourceRequest): Promise<EvidenceRecord>;
 getDraft(request: ResourceRequest): Promise<DraftRecord>;
}
