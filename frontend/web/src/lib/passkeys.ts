import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';

export const passkeysSupported = () => browserSupportsWebAuthn();

/** Turns the browser's refusal into a sentence a person can act on. */
function explain(e: unknown): Error {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError')
    return new Error('The passkey prompt was cancelled or timed out. Try again.');
  if (name === 'InvalidStateError')
    return new Error('This device already has a passkey for this account.');
  return e instanceof Error ? e : new Error('The passkey could not be used.');
}

/** Shows the browser's passkey sheet for a challenge from the server. */
export async function makePasskey(options: unknown): Promise<unknown> {
  try {
    return await startRegistration({ optionsJSON: options as never });
  } catch (e) {
    throw explain(e);
  }
}

export async function answerPasskey(options: unknown): Promise<unknown> {
  try {
    return await startAuthentication({ optionsJSON: options as never });
  } catch (e) {
    throw explain(e);
  }
}
