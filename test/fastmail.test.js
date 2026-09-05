const test = require("node:test");
const assert = require("node:assert/strict");
const {
  bodyText, candidateEmail, fetchRecentEmails, mailAccountIds, normaliseEmail
} = require("../lib/fastmail");

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

test("selects forwarded US confirmations from their subject", () => {
  assert.equal(candidateEmail({
    from: [{ email: "forwarder@example.com" }],
    subject: "You Got Tickets To SAINT LEVANT - AFANDI WORLD TOUR"
  }), true);
  assert.equal(candidateEmail({ from: [{ email: "news@example.com" }], subject: "Weekly news" }), false);
});

test("includes every accessible Fastmail mail account", () => {
  const mail = "urn:ietf:params:jmap:mail";
  assert.deepEqual(mailAccountIds({ accounts: {
    primary: { accountCapabilities: { [mail]: {} } },
    shared: { accountCapabilities: { [mail]: {} } },
    calendar: { accountCapabilities: {} }
  } }, "primary"), ["primary", "shared"]);
});

test("pages through more than one Fastmail result batch", async () => {
  const calls = [];
  const request = async (url, token, options) => {
    if (!options) return {
      apiUrl: "https://api.example.test/jmap",
      primaryAccounts: { "urn:ietf:params:jmap:mail": "account-1" }
    };
    const payload = JSON.parse(options.body);
    if (payload.methodCalls[0][0] === "Email/get") {
      const ids = payload.methodCalls[0][1].ids;
      return { methodResponses: [["Email/get", { list: ids.map(id => ({
        id, subject: "Order", from: [{ email: "orders@ticketmaster.com" }],
        to: [{ email: "catchall@example.com" }], receivedAt: "2026-09-01T12:00:00Z",
        bodyValues: { p: { value: id } }, textBody: [{ partId: "p" }]
      })) }, "bodies"]] };
    }
    const query = payload.methodCalls[0][1];
    calls.push(query.position);
    assert.deepEqual(query.filter, { after: query.filter.after });
    const ids = query.position === 0 ? ["m2"] : ["m1"];
    return { methodResponses: [
      ["Email/query", { ids, total: 2 }, "query"],
      ["Email/get", { list: ids.map(id => ({
        id, subject: "Order", from: [{ email: "orders@ticketmaster.com" }]
      })) }, "headers"]
    ] };
  };
  const emails = await fetchRecentEmails({ token: "test-token", pageSize: 1, limit: 10, request });
  assert.deepEqual(calls, [0, 1]);
  assert.deepEqual(emails.map(email => email.id), ["m2", "m1"]);
  assert.equal(emails.mailAccountsChecked, 1);
  assert.equal(emails.mailboxMessagesChecked, 2);
});
