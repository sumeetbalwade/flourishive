import { randomBytes } from 'node:crypto';
import type { RedisService } from '../../../platform/cache/redis.service.js';
import type {
  EsignOutcome,
  EsignProvider,
  EsignStarted,
  EsignStartInput,
} from './provider.js';

const TTL = 3600;
const key = (id: string) => `esign:mock:${id}`;

interface MockState {
  returnUrl: string;
  signerName: string;
  documentName: string;
  decision: 'pending' | 'approved' | 'declined';
}

/**
 * A stand-in for a real provider (D-44). It shows a page with Approve and Decline buttons instead of
 * Aadhaar authentication, so the whole flow can be built and tried. Anything signed this way is TEST.
 */
export class MockEsignProvider implements EsignProvider {
  readonly key = 'mock';

  constructor(
    private readonly redis: RedisService,
    private readonly apiUrl: string,
  ) {}

  async start(input: EsignStartInput): Promise<EsignStarted> {
    const id = randomBytes(16).toString('hex');
    const state: MockState = {
      returnUrl: input.returnUrl,
      signerName: input.signerName,
      documentName: input.documentName,
      decision: 'pending',
    };
    await this.redis.client.set(key(id), JSON.stringify(state), 'EX', TTL);
    return {
      providerTxnId: id,
      redirectUrl: `${this.apiUrl.replace(/\/$/, '')}/v1/public/esign/mock/${id}`,
    };
  }

  async state(id: string): Promise<MockState | null> {
    const raw = await this.redis.client.get(key(id));
    return raw ? (JSON.parse(raw) as MockState) : null;
  }

  /** Called by the mock page's buttons. Returns where to send the browser next. */
  async decide(id: string, approved: boolean): Promise<string | null> {
    const s = await this.state(id);
    if (!s) return null;
    s.decision = approved ? 'approved' : 'declined';
    await this.redis.client.set(key(id), JSON.stringify(s), 'EX', TTL);
    return s.returnUrl;
  }

  async finish(providerTxnId: string): Promise<EsignOutcome> {
    const s = await this.state(providerTxnId);
    if (!s) return { status: 'FAILED', reason: 'The signing session expired' };
    if (s.decision === 'approved')
      return {
        status: 'SIGNED',
        signedPdf: null,
        test: true,
        methodLabel: 'Aadhaar eSign (mock provider, TEST)',
      };
    if (s.decision === 'declined') return { status: 'DECLINED' };
    return { status: 'FAILED', reason: 'Signing was not completed' };
  }
}
