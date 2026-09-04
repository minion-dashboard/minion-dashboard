const SESSION_URL = "https://api.fastmail.com/jmap/session";
const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";

async function jsonRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`Fastmail request failed (${response.status})`);
  return response.json();
}

function bodyText(email) {
  const values = email.bodyValues || {};
  const parts = (email.textBody || []).map(part => values[part.partId] && values[part.partId].value).filter(Boolean);
  if (parts.length) return parts.join("\n");
  const html = (email.htmlBody || []).map(part => values[part.partId] && values[part.partId].value).filter(Boolean).join(" ");
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"').replace(/&times;/gi, "x").replace(/&pound;/gi, "£")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
}

function firstEmail(addresses) {
  return Array.isArray(addresses) && addresses[0] && addresses[0].email ? addresses[0].email : "";
}

function normaliseEmail(email) {
  return {
    id: email.id,
    messageId: Array.isArray(email.messageId) ? email.messageId[0] || "" : "",
    subject: email.subject || "",
    from: firstEmail(email.from || email.sender),
    to: firstEmail(email.to),
    receivedAt: email.receivedAt || email.sentAt || "",
    body: bodyText(email)
  };
}

async function fetchRecentEmails({ token = process.env.FASTMAIL_API_TOKEN, days = 14, limit = 500 } = {}) {
  if (!token) throw new Error("Fastmail API token is missing");
  const session = await jsonRequest(SESSION_URL, token);
  const accountId = session.primaryAccounts && session.primaryAccounts[MAIL];
  if (!accountId || !session.apiUrl) throw new Error("Fastmail mail account is unavailable");
  const after = new Date(Date.now() - Math.max(1, Math.min(Number(days) || 14, 90)) * 86400000).toISOString();
  const payload = {
    using: [CORE, MAIL],
    methodCalls: [
      ["Email/query", {
        accountId,
        filter: {
          operator: "AND",
          conditions: [
            { after },
            { operator: "OR", conditions: [{ from: "lysted" }, { from: "viagogo" }, { from: "ticketmaster" }] }
          ]
        },
        sort: [{ property: "receivedAt", isAscending: false }],
        limit: Math.max(1, Math.min(Number(limit) || 500, 1000))
      }, "query"],
      ["Email/get", {
        accountId,
        "#ids": { resultOf: "query", name: "Email/query", path: "/ids" },
        properties: ["id", "messageId", "subject", "from", "sender", "to", "receivedAt", "sentAt", "bodyValues", "textBody", "htmlBody"],
        fetchTextBodyValues: true,
        fetchHTMLBodyValues: true,
        maxBodyValueBytes: 1000000
      }, "get"]
    ]
  };
  const result = await jsonRequest(session.apiUrl, token, { method: "POST", body: JSON.stringify(payload) });
  const error = (result.methodResponses || []).find(response => response[0] === "error");
  if (error) throw new Error(`Fastmail JMAP error: ${error[1] && error[1].type || "unknown"}`);
  const getResponse = (result.methodResponses || []).find(response => response[0] === "Email/get");
  if (!getResponse) throw new Error("Fastmail returned no email data");
  return (getResponse[1].list || []).map(normaliseEmail);
}

module.exports = { bodyText, fetchRecentEmails, normaliseEmail };
