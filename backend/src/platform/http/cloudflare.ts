import { BlockList, isIP } from 'node:net';

/**
 * Cloudflare's published edge ranges (https://www.cloudflare.com/ips). They change rarely;
 * set CLOUDFLARE_IP_RANGES (comma separated CIDRs) to override without a release.
 */
export const CLOUDFLARE_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

export function cloudflareMatcher(
  ranges: string[] = CLOUDFLARE_RANGES,
): (ip: string | undefined) => boolean {
  const list = new BlockList();
  for (const r of ranges) {
    const [net, bits] = r.split('/');
    const v = isIP(net ?? '');
    if (!net || !bits || !v) continue;
    list.addSubnet(net, Number(bits), v === 6 ? 'ipv6' : 'ipv4');
  }
  return (ip) => {
    if (!ip) return false;
    // An IPv4 peer can be reported as ::ffff:1.2.3.4
    const plain = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    const v = isIP(plain);
    return v !== 0 && list.check(plain, v === 6 ? 'ipv6' : 'ipv4');
  };
}

/**
 * The visitor's real address when the request came through Cloudflare, otherwise the peer
 * address unchanged. CF-Connecting-IP is only believed when the connection itself comes from a
 * Cloudflare address, so someone calling the origin directly cannot make it up.
 */
export function visitorIp(
  peer: string | undefined,
  cfHeader: string | string[] | undefined,
  isCloudflare: (ip: string | undefined) => boolean,
): string | undefined {
  const value = Array.isArray(cfHeader) ? cfHeader[0] : cfHeader;
  if (value && isIP(value.trim()) !== 0 && isCloudflare(peer))
    return value.trim();
  return peer;
}
