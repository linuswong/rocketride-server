// Design only. There is no server, identity implementation, or deployable API.
// A browser must never construct a VerifiedPrincipal for authorization.
export interface VerifiedPrincipal {
  readonly subject: string;
  readonly organizationId: string;
  readonly permissions: readonly string[];
}

// Implementations must verify the credential AND obtain current membership
// from a trusted authority. Absence, uncertainty, or service failure denies.
export interface IdentityBoundary {
  verifyAndResolve(credential: string, organizationSelector: string): Promise<VerifiedPrincipal>;
}

// Each operation must enforce current permission and organization ownership;
// implementations must not accept a browser-supplied principal as proof.
export interface AuthorizedTicketStore {
  list(principal: VerifiedPrincipal, cursor: string | null, limit: number): Promise<unknown>;
  read(principal: VerifiedPrincipal, ticketId: string): Promise<unknown>;
  create(principal: VerifiedPrincipal, input: unknown, idempotencyKey: string): Promise<unknown>;
  update(principal: VerifiedPrincipal, ticketId: string, expectedVersion: number, input: unknown): Promise<unknown>;
  createInvestigation(principal: VerifiedPrincipal, ticketId: string, input: unknown, idempotencyKey: string): Promise<unknown>;
  readInvestigation(principal: VerifiedPrincipal, investigationId: string): Promise<unknown>;
}
