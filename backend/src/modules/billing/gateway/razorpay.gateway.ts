import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { RuntimeConfigService } from '../../../platform/config/runtime-config.service.js';
import type { Interval, PaymentGateway } from './payment-gateway.js';

const API = 'https://api.razorpay.com/v1';

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Razorpay Subscriptions: cards, UPI AutoPay and netbanking mandates (D-21). Keys come from the console. */
@Injectable()
export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay';

  constructor(private readonly runtime: RuntimeConfigService) {}

  private async keys() {
    const [id, secret] = await Promise.all([
      this.runtime.get('RAZORPAY_KEY_ID'),
      this.runtime.get('RAZORPAY_KEY_SECRET'),
    ]);
    if (!id || !secret)
      throw new ServiceUnavailableException(
        'Online payment is not set up yet. Please contact support.',
      );
    return { id, secret };
  }

  async configured(): Promise<boolean> {
    const [id, secret] = await Promise.all([
      this.runtime.get('RAZORPAY_KEY_ID'),
      this.runtime.get('RAZORPAY_KEY_SECRET'),
    ]);
    return Boolean(id && secret);
  }

  async publicKey(): Promise<string> {
    return (await this.keys()).id;
  }

  private async call<T>(
    method: 'POST' | 'GET',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const { id, secret } = await this.keys();
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as
      (T & { error?: { description?: string } }) | null;
    if (!res.ok || !json)
      throw new BadGatewayException(
        `The payment provider refused: ${json?.error?.description ?? `HTTP ${res.status}`}`,
      );
    return json;
  }

  async createPlan(p: {
    name: string;
    interval: Interval;
    amount: number;
  }): Promise<string> {
    const r = await this.call<{ id: string }>('POST', '/plans', {
      period: p.interval === 'YEARLY' ? 'yearly' : 'monthly',
      interval: 1,
      item: { name: p.name, amount: p.amount, currency: 'INR' },
    });
    return r.id;
  }

  async createSubscription(p: {
    gatewayPlanId: string;
    totalCount: number;
    notes: Record<string, string>;
  }): Promise<{ id: string }> {
    const r = await this.call<{ id: string }>('POST', '/subscriptions', {
      plan_id: p.gatewayPlanId,
      total_count: p.totalCount,
      customer_notify: 1,
      notes: p.notes,
    });
    return { id: r.id };
  }

  async cancelSubscription(id: string, atCycleEnd: boolean): Promise<void> {
    await this.call('POST', `/subscriptions/${id}/cancel`, {
      cancel_at_cycle_end: atCycleEnd ? 1 : 0,
    });
  }

  async verifyCheckout(p: {
    paymentId: string;
    subscriptionId: string;
    signature: string;
  }): Promise<boolean> {
    const { secret } = await this.keys();
    const expected = createHmac('sha256', secret)
      .update(`${p.paymentId}|${p.subscriptionId}`)
      .digest('hex');
    return safeEqual(expected, p.signature);
  }

  async verifyWebhook(rawBody: Buffer, signature: string): Promise<boolean> {
    const secret = await this.runtime.get('RAZORPAY_WEBHOOK_SECRET');
    if (!secret || !signature) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return safeEqual(expected, signature);
  }
}
