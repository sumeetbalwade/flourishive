/** An open support session: set when staff open a company, removed when it ends or expires. */
export const supportSessionKey = (sessionId: string) =>
  `support:session:${sessionId}`;
/** Who is a support principal in a company, and in which mode (read by AccessService). */
export const supportPrincipalKey = (tenantId: string, userId: string) =>
  `support:principal:${tenantId}:${userId}`;

export interface OpenSupportSession {
  sessionId: string;
  tenantId: string;
  platformUserId: string;
  staffEmail: string;
  mode: 'READ' | 'WRITE';
  reason: string;
  expiresAt: string;
}
