import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { BadRequestException } from '@nestjs/common';

/** The only ports a company's own mail server may use (D-60). */
export const ALLOWED_SMTP_PORTS = [25, 465, 587, 2525];

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, including the cloud metadata address 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, bits, 'ipv6');

/** True for private, loopback, link-local, metadata and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const addr = mapped ? mapped[1]! : ip;
  const family = isIP(addr);
  if (!family) return true;
  return blocked.check(addr, family === 4 ? 'ipv4' : 'ipv6');
}

/** Development only: lets a company point at a local mail catcher such as Mailpit. */
const allowPrivate = () =>
  process.env.NODE_ENV !== 'production' &&
  process.env.MAIL_ALLOW_PRIVATE_SMTP === 'true';

/**
 * Checks a company-supplied mail server before we connect to it, and returns the address to connect to.
 * Connecting to the address we checked (not the name) closes the "name changes after the check" gap.
 */
export async function resolvePublicSmtpHost(
  host: string,
  port: number,
  resolve: (h: string) => Promise<string[]> = async (h) =>
    (await lookup(h, { all: true })).map((a) => a.address),
): Promise<string> {
  if (!ALLOWED_SMTP_PORTS.includes(port))
    throw new BadRequestException(
      `Use one of the standard mail ports: ${ALLOWED_SMTP_PORTS.join(', ')}.`,
    );
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch {
    throw new BadRequestException(
      'That mail server name could not be found. Check the spelling.',
    );
  }
  if (!addresses.length)
    throw new BadRequestException('That mail server name has no address.');
  if (!allowPrivate() && addresses.some(isPrivateAddress))
    throw new BadRequestException(
      'That mail server is on a private network, so we cannot connect to it.',
    );
  return addresses[0]!;
}
