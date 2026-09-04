const test = require("node:test");
const assert = require("node:assert/strict");
const { bodyText, normaliseEmail } = require("../lib/fastmail");

test("prefers the Fastmail plain-text body", () => {
  const email = {
    bodyValues: { plain: { value: "Plain confirmation" }, html: { value: "<b>HTML</b>" } },
    textBody: [{ partId: "plain" }], htmlBody: [{ partId: "html" }]
  };
  assert.equal(bodyText(email), "Plain confirmation");
});

test("converts an HTML-only message into parser-friendly text", () => {
  const email = {
    bodyValues: { html: { value: "<p>Payout: &pound;120.00</p><p>2 &times; tickets</p>" } },
    htmlBody: [{ partId: "html" }]
  };
  assert.equal(bodyText(email), "Payout: £120.00\n2 x tickets");
});

test("normalises JMAP address and message fields", () => {
  const result = normaliseEmail({
    id: "m1", messageId: ["<example>"], subject: "Sale",
    from: [{ email: "sales@example.com" }], to: [{ email: "catchall@example.com" }],
    receivedAt: "2026-09-04T10:00:00Z", bodyValues: { p: { value: "Body" } }, textBody: [{ partId: "p" }]
  });
  assert.deepEqual(result, {
    id: "m1", messageId: "<example>", subject: "Sale", from: "sales@example.com",
    to: "catchall@example.com", receivedAt: "2026-09-04T10:00:00Z", body: "Body"
  });
});
