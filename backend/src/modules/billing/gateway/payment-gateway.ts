export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export type Interval = 'MONTHLY' | 'YEARLY';

/** The only way billing talks to a payment provider (D-21). Razorpay is the first driver. */
export interface PaymentGateway {
  readonly name: string;
  /** False until the super admin has saved the keys. */
  configured(): Promise<boolean>;
  /** Key the browser needs to open the checkout. Never the secret. */
  publicKey(): Promise<string>;
  /** Creates the recurring plan at the provider and returns its id. */
  createPlan(p: {
    name: string;
    interval: Interval;
    amount: number;
  }): Promise<string>;
  createSubscription(p: {
    gatewayPlanId: string;
    totalCount: number;
    notes: Record<string, string>;
  }): Promise<{ id: string }>;
  cancelSubscription(id: string, atCycleEnd: boolean): Promise<void>;
  /** The browser proves a mandate was authorised: signature over payment and subscription ids. */
  verifyCheckout(p: {
    paymentId: string;
    subscriptionId: string;
    signature: string;
  }): Promise<boolean>;
  /** The provider proves a webhook is theirs: signature over the exact body. */
  verifyWebhook(rawBody: Buffer, signature: string): Promise<boolean>;
}
