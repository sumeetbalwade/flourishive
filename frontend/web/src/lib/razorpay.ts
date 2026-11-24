/** Opens Razorpay's payment window for a subscription. Loads their script the first time. */
interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}
interface RazorpayOptions {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  handler: (r: RazorpayResponse) => void;
  modal: { ondismiss: () => void };
  theme?: { color: string };
}
declare global {
  interface Window {
    Razorpay?: new (o: RazorpayOptions) => { open: () => void };
  }
}

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('Could not load the payment window. Check your connection.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Resolves with the provider's proof of payment, or null if the person closed the window. */
export async function payWithRazorpay(c: {
  keyId: string;
  subscriptionId: string;
  name: string;
  description: string;
}): Promise<RazorpayResponse | null> {
  await loadScript();
  return new Promise((resolve) => {
    const rzp = new window.Razorpay!({
      key: c.keyId,
      subscription_id: c.subscriptionId,
      name: c.name,
      description: c.description,
      handler: (r) => resolve(r),
      modal: { ondismiss: () => resolve(null) },
    });
    rzp.open();
  });
}
