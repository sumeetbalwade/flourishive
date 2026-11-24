/** The little of jsdom the SVG cleaner uses. */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { contentType?: string });
    window: Window & {
      XMLSerializer: new () => { serializeToString(n: unknown): string };
    };
  }
}
