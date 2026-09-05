const { classifyEmail, parseLysted, parseTicketmaster, parseViagogo } = require("./email-parsers");
const { fetchRecentEmails } = require("./fastmail");
const { client, sheetId } = require("./sheets");

const IMPORT_TAB = "ImportLog";
const IMPORT_COLUMNS = ["Fastmail Message ID", "Type", "External ID", "Received", "Imported", "Status"];

async function ensureImportTab(sheets, spreadsheetId) {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (metadata.data.sheets || []).some(sheet => sheet.properties.title === IMPORT_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: IMPORT_TAB } } }] }
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${IMPORT_TAB}!A1:F1`,
      valueInputOption: "RAW",
      requestBody: { values: [IMPORT_COLUMNS] }
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Orders!L1",
    valueInputOption: "RAW",
    requestBody: { values: [["Purchase date"]] }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Orders!M1",
    valueInputOption: "RAW",
    requestBody: { values: [["Currency"]] }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Viagogo!J1",
    valueInputOption: "RAW",
    requestBody: { values: [["Profit"]] }
  });
}

async function values(sheets, spreadsheetId, range) {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return response.data.values || [];
}

async function writeUpsert(sheets, spreadsheetId, tab, idColumn, width, records, rowForRecord, preserveRow) {
  if (!records.length) return { added: 0, updated: 0 };
  const existing = await values(sheets, spreadsheetId, `${tab}!A:${String.fromCharCode(64 + width)}`);
  const idToRow = new Map();
  existing.slice(1).forEach((row, index) => {
    const id = String(row[idColumn] || "").trim();
    if (id) idToRow.set(id, { number: index + 2, row });
  });
  const updates = [];
  const appends = [];
  records.forEach(record => {
    const id = String(record.order_id || "").trim();
    const match = idToRow.get(id);
    let row = rowForRecord(record);
    if (match) {
      if (preserveRow) row = preserveRow(row, match.row);
      updates.push({ range: `${tab}!A${match.number}:${String.fromCharCode(64 + width)}${match.number}`, values: [row] });
    } else {
      appends.push(row);
      idToRow.set(id, { number: existing.length + appends.length, row });
    }
  });
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: updates }
    });
  }
  if (appends.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tab}!A:${String.fromCharCode(64 + width)}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: appends }
    });
  }
  return { added: appends.length, updated: updates.length };
}

function mergeRecords(messages) {
  const records = new Map();
  messages.forEach(({ record }) => {
    const existing = records.get(record.order_id) || {};
    Object.keys(record).forEach(key => {
      if (record[key] === "" || record[key] == null) return;
      if (key === "purchased_at" && existing[key] && String(existing[key]) < String(record[key])) return;
      existing[key] = record[key];
    });
    records.set(record.order_id, existing);
  });
  return [...records.values()];
}

async function upsertSales(sheets, spreadsheetId, tab, messages, lysted) {
  const records = mergeRecords(messages);
  return writeUpsert(sheets, spreadsheetId, tab, 3, 9, records, record => [
    record.event || "", record.venue || "", record.date || "", record.order_id || "",
    record.section || "", record.row || "", record.qty || "", record.payout || "",
    lysted ? record.profit || "" : "No"
  ], (next, current) => {
    if (!lysted && current[8]) next[8] = current[8];
    return next;
  });
}

async function upsertOrders(sheets, spreadsheetId, messages) {
  const records = mergeRecords(messages);
  return writeUpsert(sheets, spreadsheetId, "Orders", 8, 13, records, record => [
    record.event || "", record.date || "", record.venue || "", record.section || "",
    record.row || "", record.seats || "", record.qty || "", record.cost || "",
    record.order_id || "", record.account || "", record.status || "", record.purchased_at || "",
    record.order_currency || ""
  ], (next, current) => {
    if (String(current[10] || "") === "Confirmed") next[10] = "Confirmed";
    if (current[11]) next[11] = current[11];
    if (current[12]) next[12] = current[12];
    return next;
  });
}

function currencySymbol(value) {
  const match = String(value || "").match(/[£$€]/);
  return match ? match[0] : "";
}

function idAppears(text, id) {
  const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`, "i").test(text);
}

async function applyPayments(sheets, spreadsheetId, paymentMessages) {
  if (!paymentMessages.length) return new Set();
  const rows = await values(sheets, spreadsheetId, "Viagogo!A:I");
  const updates = new Map();
  const matchedMessages = new Set();
  rows.slice(1).forEach((row, index) => {
    const orderId = String(row[3] || "").trim();
    if (!orderId || String(row[8] || "") === "Yes" || String(row[8] || "") === "Cancelled") return;
    paymentMessages.forEach(({ email }) => {
      if (idAppears(`${email.subject}\n${email.body}`, orderId)) {
        updates.set(index + 2, { range: `Viagogo!I${index + 2}`, values: [["Yes"]] });
        matchedMessages.add(email.id);
      }
    });
  });
  if (updates.size) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: [...updates.values()] }
    });
  }
  return matchedMessages;
}

async function appendImportLog(sheets, spreadsheetId, rows) {
  if (!rows.length) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${IMPORT_TAB}!A:F`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows }
  });
}

async function syncFastmail({ fetchEmails = fetchRecentEmails, sheets = client("https://www.googleapis.com/auth/spreadsheets"), spreadsheetId = sheetId() } = {}) {
  await ensureImportTab(sheets, spreadsheetId);
  const log = await values(sheets, spreadsheetId, `${IMPORT_TAB}!A:F`);
  const loggedIds = new Set(log.slice(1).map(row => String(row[0] || "")).filter(Boolean));
  const completedIds = new Set(log.slice(1).filter(row => ["Imported", "No change"].includes(String(row[5] || ""))).map(row => String(row[0] || "")));
  const days = Number(process.env.FASTMAIL_IMPORT_DAYS || 14);
  const fetchedEmails = await fetchEmails({ days });
  const emails = fetchedEmails.filter(email => !completedIds.has(String(email.id)));
  const groups = { lysted: [], viagogo: [], ticketmaster: [], payment: [] };
  const review = [];

  emails.forEach(email => {
    const type = classifyEmail(email);
    if (!type) return;
    if (type === "payment") return groups.payment.push({ email });
    const record = type === "lysted" ? parseLysted(email.subject, email.body) :
      type === "viagogo" ? parseViagogo(email.subject, email.body) :
        parseTicketmaster(email.subject, email.body, email.to);
    if (type === "ticketmaster") {
      record.purchased_at = email.receivedAt;
      record.order_currency = currencySymbol(record.cost);
    }
    const valid = type === "ticketmaster"
      ? record.order_id && (record.cost || record.qty)
      : record.order_id && record.payout;
    if (valid) groups[type].push({ email, record });
    else review.push({ email, type, record });
  });

  // Re-read recent confirmations already imported by earlier dashboard versions.
  // This safely fills the dedicated currency column without adding another order.
  fetchedEmails.filter(email => completedIds.has(String(email.id)) && classifyEmail(email) === "ticketmaster")
    .forEach(email => {
      const record = parseTicketmaster(email.subject, email.body, email.to);
      record.purchased_at = email.receivedAt;
      record.order_currency = currencySymbol(record.cost);
      if (record.order_id && (record.cost || record.qty)) groups.ticketmaster.push({ email, record, replayed: true });
    });

  const [lysted, viagogo, orders] = await Promise.all([
    upsertSales(sheets, spreadsheetId, "Sheet1", groups.lysted, true),
    upsertSales(sheets, spreadsheetId, "Viagogo", groups.viagogo, false),
    upsertOrders(sheets, spreadsheetId, groups.ticketmaster)
  ]);
  const matchedPayments = await applyPayments(sheets, spreadsheetId, groups.payment);
  const importedAt = new Date().toISOString();
  const logRows = [];
  ["lysted", "viagogo", "ticketmaster"].forEach(type => {
    groups[type].forEach(({ email, record }) => logRows.push([
      email.id, type, record.order_id, email.receivedAt, importedAt, "Imported"
    ]));
  });
  groups.payment.forEach(({ email }) => logRows.push([
    email.id, "payment", "", email.receivedAt, importedAt,
    matchedPayments.has(email.id) ? "Imported" : "Review"
  ]));
  review.forEach(({ email, type }) => logRows.push([
    email.id, type, "", email.receivedAt, importedAt, "Review"
  ]));
  await appendImportLog(sheets, spreadsheetId, logRows.filter(row => !loggedIds.has(String(row[0] || ""))));

  return {
    scanned: emails.length,
    imported: groups.lysted.length + groups.viagogo.length +
      groups.ticketmaster.filter(message => !message.replayed).length + matchedPayments.size,
    review: review.length + groups.payment.length - matchedPayments.size,
    lysted,
    viagogo,
    orders,
    paymentsMatched: matchedPayments.size
  };
}

module.exports = { applyPayments, currencySymbol, idAppears, mergeRecords, syncFastmail, writeUpsert };
