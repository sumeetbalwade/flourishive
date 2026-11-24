/** The sections of the Integrations page, in order. The id is the URL piece and the menu sub-item. */
export const INTEGRATION_SECTIONS = [
  'Email',
  'Google sign-in',
  'Cloudflare',
  'Time-stamping',
  'Error tracking',
  'File storage',
  'Addresses',
  'Razorpay',
].map((label) => ({ id: slugOf(label), label }));

export function slugOf(group: string): string {
  return group.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
