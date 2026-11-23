import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';

/** Tiny CBOR writer: only what a WebAuthn "none" attestation needs. */
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number): Buffer => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  };
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') {
    const b = Buffer.from(v);
    return Buffer.concat([head(3, b.length), b]);
  }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  const entries = Object.entries(v as Record<string, unknown>);
  return Buffer.concat([
    head(5, entries.length),
    ...entries.flatMap(([k, val]) => [
      cbor(/^-?\d+$/.test(k) ? Number(k) : k),
      cbor(val),
    ]),
  ]);
}

const b64 = (b: Buffer) => b.toString('base64url');

/** A software authenticator (ES256) so the real registration and sign-in ceremonies can run in tests. */
export class VirtualAuthenticator {
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  readonly credentialId = randomBytes(16);
  counter = 0;

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
  ) {}

  private clientData(type: string, challenge: string) {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin: this.origin }),
    );
  }

  private authData(attested: boolean) {
    const flags = 0x01 | 0x04 | (attested ? 0x40 : 0); // present, verified, attested data
    const c = Buffer.alloc(4);
    c.writeUInt32BE(this.counter);
    const parts: Uint8Array[] = [
      createHash('sha256').update(this.rpId).digest(),
      Buffer.from([flags]),
      c,
    ];
    if (attested) {
      const jwk = this.keys.publicKey.export({ format: 'jwk' });
      const cose = cbor({
        1: 2,
        3: -7,
        '-1': 1,
        '-2': Buffer.from(jwk.x!, 'base64url'),
        '-3': Buffer.from(jwk.y!, 'base64url'),
      });
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.credentialId.length);
      parts.push(Buffer.alloc(16), len, this.credentialId, cose);
    }
    return Buffer.concat(parts);
  }

  register(challenge: string) {
    const clientData = this.clientData('webauthn.create', challenge);
    const attestationObject = cbor({
      fmt: 'none',
      attStmt: {},
      authData: this.authData(true),
    });
    return {
      id: b64(this.credentialId),
      rawId: b64(this.credentialId),
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64(clientData),
        attestationObject: b64(attestationObject),
        transports: ['internal'],
      },
    };
  }

  /** Pass `counter` to force a value (to replay an old one). */
  sign(challenge: string, counter?: number) {
    this.counter = counter ?? this.counter + 1;
    const clientData = this.clientData('webauthn.get', challenge);
    const authData = this.authData(false);
    const signature = createSign('sha256')
      .update(
        Buffer.concat([
          authData,
          createHash('sha256').update(clientData).digest(),
        ]),
      )
      .sign(this.keys.privateKey);
    return {
      id: b64(this.credentialId),
      rawId: b64(this.credentialId),
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64(clientData),
        authenticatorData: b64(authData),
        signature: b64(signature),
      },
    };
  }
}
