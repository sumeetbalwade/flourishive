/** Fills a reference format such as FS/INT/{YYYY}/{SEQ:4}. Pure, so it is easy to test. */
export function formatReference(
  format: string,
  year: number,
  seq: number,
): string {
  return format
    .replaceAll('{YYYY}', String(year))
    .replaceAll('{YY}', String(year).slice(-2))
    .replace(/\{SEQ:(\d)\}/g, (_, n: string) =>
      String(seq).padStart(Number(n), '0'),
    );
}
