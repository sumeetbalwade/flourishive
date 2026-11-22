/** What every Aadhaar eSign provider must do. A real provider is a second implementation of this. */
export interface EsignStartInput {
  /** Our id for the trip; echoed back so a callback can be matched. */
  reference: string;
  documentName: string;
  documentSha256: string;
  document: Buffer;
  signerName: string;
  /** Where the provider sends the person's browser when they finish. */
  returnUrl: string;
}

export interface EsignStarted {
  providerTxnId: string;
  /** The provider's page where the person authenticates with Aadhaar. */
  redirectUrl: string;
}

export type EsignOutcome =
  | {
      status: 'SIGNED';
      /** The provider's signed PDF. Null means the provider only confirms; we then seal the file ourselves. */
      signedPdf: Buffer | null;
      /** True for the mock provider; the document is then labelled TEST everywhere. */
      test: boolean;
      /** Shown on the acceptance record. */
      methodLabel: string;
    }
  | { status: 'DECLINED' }
  | { status: 'FAILED'; reason: string };

export interface EsignProvider {
  readonly key: string;
  start(input: EsignStartInput): Promise<EsignStarted>;
  /** Asks the provider how the trip ended. Called when the person comes back. */
  finish(providerTxnId: string): Promise<EsignOutcome>;
}

export const ESIGN_PROVIDER = Symbol('ESIGN_PROVIDER');
