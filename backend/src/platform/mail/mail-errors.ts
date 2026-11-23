/** Turns what a mail server said into a sentence an admin can act on (D-60). */
export function explainMailError(err: unknown): string {
  const e = err as {
    code?: string;
    responseCode?: number;
    response?: string;
    message?: string;
  };
  const text = `${e?.response ?? ''} ${e?.message ?? ''}`.toLowerCase();
  const smtp = e?.responseCode;
  if (e?.code === 'EAUTH' || smtp === 535 || smtp === 534) {
    if (
      text.includes('gmail') ||
      text.includes('google') ||
      text.includes('5.7.8')
    )
      return 'Gmail refused the login. Use an app password, not your normal password.';
    return 'The mail server refused the username or password. Check them and try again.';
  }
  if (e?.code === 'ENOTFOUND' || e?.code === 'EDNS')
    return 'The mail server name could not be found. Check the spelling.';
  if (e?.code === 'ECONNREFUSED')
    return 'The mail server refused the connection. Check the port and the secure setting.';
  if (
    e?.code === 'ETIMEDOUT' ||
    e?.code === 'ESOCKET' ||
    e?.code === 'ECONNECTION' ||
    e?.code === 'ETIMEOUT'
  )
    return text.includes('wrong version number') || text.includes('ssl')
      ? 'The secure setting does not match the port. Port 465 is "secure", 587 usually is not.'
      : 'The mail server did not answer in time. Check the host and port.';
  if (smtp === 550 || smtp === 553 || smtp === 551)
    return 'The mail server rejected the address. Check the “from” address belongs to this account.';
  if (smtp === 552 || smtp === 452)
    return 'The mail server says the mailbox is full or the message is too large.';
  if (smtp === 554)
    return 'The mail server refused the message, often because it looked like spam.';
  if (smtp === 421 || smtp === 450 || smtp === 451)
    return 'The mail server is busy right now. It will be tried again.';
  return 'The mail server did not accept the message.';
}

/** `asha.k@gmail.com` becomes `as***@gmail.com`. */
export function maskAddress(address: string): string {
  const [local = '', domain = ''] = address.trim().split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}
