const { toDate } = require('./utils');

// Read only an explicitly labelled purchase date or the original forwarded header.
// Do not confuse the event date or the forwarding/receipt date with purchase time.
function purchaseTimestamp(email) {
  const body = String(email.body || '');
  const labelled = /(?:^|\n)\s*(?:Purchase date|Purchased at|Order date)\s*:\s*([^\n]+)/i.exec(body);
  const forwarded = /(?:^|\n)\s*(?:Date|Sent):\s*([^\n]+)/i.exec(body);
  for (const match of [labelled, forwarded]) {
    if (!match) continue;
    const value = match[1].trim();
    const date = toDate(value);
    if (date) return date.toISOString();
    // RFC mail dates must state a year and timezone; ambiguous locale dates are unsafe.
    if (/\d{4}/.test(value) && /(?:[+-]\d{4}|GMT|UTC)\s*(?:\([^)]*\))?$/i.test(value)) {
      const timestamp = Date.parse(value);
      if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
    }
  }
  const forwardedMessage = /Forwarded message|Begin forwarded message|Original Message|(?:^|\n)\s*From:/i.test(body)
    || /^(?:fwd?|fw)\s*:/i.test(email.subject || '');
  if (forwardedMessage || !/^[^@\s]+@(?:[a-z0-9-]+\.)*ticketmaster\.[a-z.]+$/i.test(email.from || '')) return '';
  return toDate(email.sentAt)?.toISOString() || toDate(email.receivedAt)?.toISOString() || '';
}
module.exports = { purchaseTimestamp };
