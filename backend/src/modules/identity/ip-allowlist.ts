import { isIP } from 'node:net';

/** `::ffff:1.2.3.4` is the same visitor as `1.2.3.4`. */
const plain = (ip: string) => ip.replace(/^::ffff:/i, '');

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
}

function v6ToBigInt(ip: string): bigint | null {
  if (isIP(ip) !== 6) return null;
  const [head = '', tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const fill = ip.includes('::') ? 8 - h.length - t.length : 0;
  const groups = [...h, ...Array<string>(fill).fill('0'), ...t];
  if (groups.length !== 8) return null;
  return groups.reduce(
    (n, g) => (n << 16n) + BigInt(parseInt(g || '0', 16)),
    0n,
  );
}

/** True when `ip` falls inside any of the ranges (`1.2.3.0/24`, `1.2.3.4`, `2001:db8::/32`). */
export function ipAllowed(
  rawIp: string | undefined,
  ranges: string[],
): boolean {
  if (ranges.length === 0) return true;
  if (!rawIp) return false;
  const ip = plain(rawIp);
  const kind = isIP(ip);
  if (kind === 0) return false;
  for (const r of ranges) {
    const [addr = '', bitsText] = r.split('/');
    if (kind === 4 && isIP(addr) === 4) {
      const bits = bitsText === undefined ? 32 : Number(bitsText);
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      if ((v4ToInt(ip) & mask) >>> 0 === (v4ToInt(addr) & mask) >>> 0)
        return true;
    } else if (kind === 6 && isIP(addr) === 6) {
      const bits = bitsText === undefined ? 128 : Number(bitsText);
      const a = v6ToBigInt(ip);
      const b = v6ToBigInt(addr);
      if (a === null || b === null) continue;
      const shift = BigInt(128 - bits);
      if (a >> shift === b >> shift) return true;
    }
  }
  return false;
}
