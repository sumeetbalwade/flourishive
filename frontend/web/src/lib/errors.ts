import { ApiError } from '@flourishive/api-client';

/** One readable sentence for any failure; never a stack trace or raw JSON. */
export function messageOf(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
    if (e.status === 403) return 'You do not have permission to do that.';
    // A fault on our side comes with a reference people can quote and support can trace.
    if (e.status >= 500 && e.requestId) return `${e.message} (Reference: ${e.requestId})`;
    return e.message;
  }
  if (e instanceof TypeError)
    return 'Cannot reach the server. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}
