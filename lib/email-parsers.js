function find(re, text) {
  const match = re.exec(String(text || ""));
  return match ? String(match[1] || "").trim() : "";
}

function labelledMoney(label, body, defaultCurrency = "£") {
  const match = new RegExp(label + "\\s*:?\\s*(\\(?\\s*-?\\s*[£$€]?\\s*-?\\s*[\\d,.]+\\s*\\)?)", "i").exec(body);
  if (!match) return "";
  const raw = match[1];
  const negative = raw.includes("-") || (raw.includes("(") && raw.includes(")"));
  let amount = raw.replace(/[()\-\s]/g, "");
  if (!/^[£$€]/.test(amount)) amount = defaultCurrency + amount;
  return negative ? "-" + amount : amount;
}

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12
};
const pad = value => (Number(value) < 10 ? "0" : "") + Number(value);

function cleanDate(raw) {
  if (!raw) return "";
  const value = raw.replace(/(\d)(st|nd|rd|th)/gi, "$1").replace(/[|•·]/g, " ").replace(/\s+/g, " ").trim();
  let match = /(?:[A-Za-z]+,?\s+)?([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})\s*([ap])?m?)?/i.exec(value);
  if (match && MONTHS[match[1].toLowerCase()]) {
    let hour = Number(match[4] || 0);
    if (match[6]) hour = hour % 12 + (match[6].toLowerCase() === "p" ? 12 : 0);
    return `${pad(match[2])}/${pad(MONTHS[match[1].toLowerCase()])}/${match[3]}` +
      (match[4] ? ` ${pad(hour)}:${match[5]}` : "");
  }
  match = /(?:[A-Za-z]+\s+)?(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s*[-]?\s*(\d{1,2}):(\d{2})\s*([ap])?m?)?/i.exec(value);
  if (match && MONTHS[match[2].toLowerCase()]) {
    let hour = Number(match[4] || 0);
    if (match[6]) hour = hour % 12 + (match[6].toLowerCase() === "p" ? 12 : 0);
    return `${pad(match[1])}/${pad(MONTHS[match[2].toLowerCase()])}/${match[3]}` +
      (match[4] ? ` ${pad(hour)}:${match[5]}` : "");
  }
  return raw.trim();
}

function classifyEmail(email) {
  const from = String(email.from || "").toLowerCase();
  const subject = String(email.subject || "");
  if (/viagogo/.test(from) && /(?:payment|payout)/i.test(subject)) return "payment";
  if (/lysted/.test(from) && /tickets sold/i.test(subject)) return "lysted";
  if (/viagogo/.test(from) && /you have a buyer|please send your tickets|you sold your ticket|please transfer the tickets|please upload your e-tickets/i.test(subject)) return "viagogo";
  if (/ticketmaster/.test(from)) return "ticketmaster";
  return "";
}

function parseLysted(subject, body) {
  const record = {};
  const subjectMatch = /TICKETS SOLD\s*:\s*(.+?)\s*\(Invoice\s*#?(\d+)\)/i.exec(subject);
  if (subjectMatch) {
    record.event = subjectMatch[1].trim();
    record.order_id = subjectMatch[2];
  } else {
    record.order_id = find(/Invoice\s*#?\s*(\d{5,12})/i, body);
  }
  const rawDate = find(/([A-Z][a-z]{2,8}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4},?\s*\d{1,2}:\d{2}\s*[ap]m)/i, body);
  record.date = cleanDate(rawDate);
  if (rawDate) {
    const tail = body.slice(body.indexOf(rawDate) + rawDate.length);
    record.venue = find(/^\s*\n?\s*(.+?)(?=\s+Section\b|\s+Row\b|\n|$)/i, tail);
    if (/^section/i.test(record.venue)) record.venue = "";
  }
  record.section = find(/Section\s*:?\s*([A-Za-z0-9 \-]+?)(?=\s*\n|\s+Row\b)/i, body);
  record.row = find(/\bRow\s*:?\s*([A-Za-z0-9\-]+)/i, body);
  record.qty = find(/Per Ticket\s*:?\s*(\d+)\s*[×x]/i, body) || find(/(\d+)\s*[×x]\s*\$/i, body);
  record.payout = labelledMoney("Payout", body, "$");
  record.profit = labelledMoney("Profit", body, "$");
  return record;
}

function parseViagogo(subject, body) {
  const record = {};
  let match = /You sold your tickets? for (.+?) - Order\s*#?\s*(\d+)/i.exec(subject);
  if (match) {
    record.event = match[1].trim();
    record.order_id = match[2];
  } else {
    record.order_id = find(/Order\s*ID\s*#?\s*[:#]?\s*(\d{6,12})/i, body) || find(/(\d{6,12})/, subject);
    record.event = find(/Event\s*:\s*([^\n]+)/i, body);
  }
  record.payout = labelledMoney("Payment Total", body, "£") || labelledMoney("Total Proceeds", body, "£");
  record.qty = find(/(\d+)\s*Ticket\(s\)/i, body);
  record.section = find(/Section\s*:?\s*([^,\n]+)/i, body);
  record.row = find(/Row\s*(?:\|\s*Seat\(s\))?\s*[-:]?\s*([^\n]*)/i, body);
  if (record.row === "-") record.row = "";
  const rawDate = find(/((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,?\s+\w+\s+\d{1,2},?\s+\d{4}(?:\s*[|]\s*\d{1,2}:\d{2})?)/i, body) ||
    find(/Date\s*:\s*([^\n]+)/i, body);
  record.date = cleanDate(rawDate);
  record.venue = find(/Venue\s*:\s*([^\n]+)/i, body);
  const combined = /Section\s*([^,\n]*),\s*Row\s*([^,(\n]*)(?:,\s*Seat\(s\)\s*[^,(\n]*)?,?\s*\((\d+)\s*Ticket/i.exec(body);
  if (combined) {
    record.section = combined[1].trim();
    record.row = combined[2].trim();
    record.qty = combined[3];
  }
  return record;
}

function stripForwarding(body) {
  return String(body || "")
    .replace(/https?:\/\/click\.mailing\.ticketmaster\.com\/\?qs=[^\s]+/gi, " ")
    .replace(/https?:\/\/[^\s]+/gi, " ")
    .replace(/-+\s*Forwarded message\s*-+/gi, " ")
    .replace(/^\s*(From|To|Date|Subject|Reply-To|Sent|Cc):.*$/gim, " ")
    .replace(/\s+/g, " ").trim();
}

function parseTicketmaster(subject, rawBody, recipient = "") {
  const body = stripForwarding(rawBody);
  const record = { account: find(/To:\s*([\w.\-+]+@[\w.\-]+)/i, rawBody) || recipient, status: "" };
  record.order_id = find(/ORDER\s*#\s*:?\s*([A-Z0-9][A-Z0-9/\-]{3,20})/i, body) ||
    find(/Order\s*Update\s+([A-Z0-9]{6,})/i, subject);
  if (record.order_id && !/\d/.test(record.order_id)) record.order_id = "";

  const datePattern = /(?:Mon|Tue|Tues|Wed|Wednes|Thu|Thur|Thurs|Fri|Sat|Satur|Sun)(?:day|s)?\.?\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\s*(?:[-•·]\s*)?\d{1,2}:\d{2}\s*(?:[ap]m)?|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s*[·.\-]\s*[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}\s*[·.\-]\s*\d{1,2}:\d{2}\s*[ap]m|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}/i;
  const dateMatch = datePattern.exec(body);
  const dateText = dateMatch ? dateMatch[0] : "";
  record.date = cleanDate(dateText);

  // Labelled UK template: ORDER # ... <event> <venue> <date> Ticket Quantity: N
  const labelled = /ORDER\s*#?\s*:?\s*[A-Z0-9][A-Z0-9/\-]{3,20}\s+([A-Za-z0-9][\s\S]*?)\s+((?:Mon|Tues?|Wednes|Thurs?|Fri|Satur|Sun)(?:day)?\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\s+\d{1,2}:\d{2})\s+Ticket Quantity/i.exec(body);
  if (labelled) {
    const chunk = labelled[1].trim();
    const venue = /^(.*?)\s+(The\s+[A-Z0-9][\w' ]+|[A-Z][\w']+\s+(?:Arena|Stadium|Academy|Hall|Centre|Center|Theatre|Theater|Club|Grounds|Park))$/.exec(chunk);
    record.event = venue ? venue[1].trim() : chunk;
    record.venue = venue ? venue[2].trim() : "";
    record.date = cleanDate(labelled[2]);
  }

  if (dateMatch) {
    const before = body.slice(0, dateMatch.index)
      .replace(/.*ORDER\s*#?\s*:?\s*[A-Z0-9][A-Z0-9/\-]{3,20}/i, "")
      .replace(/You got the tickets|View in browser|View Tickets|Your ticket confirmation|View Mobile Ticket|My Account/gi, " ")
      .replace(/[•|]+$/, "").replace(/\s+/g, " ").trim();
    if (!record.event) record.event = before;
    const after = body.slice(dateMatch.index + dateText.length);
    const venueMatch = /^\s*[-•·]?\s*([^]*?)(?:\s+\d+x?\s*Mobile Ticket|\s+Sec\b|\s+Section\b|\s+Ticket Quantity|\s+This email|\s+View\b|\s+SECTION|$)/i.exec(after);
    if (!record.venue) record.venue = venueMatch ? venueMatch[1].replace(/\s+/g, " ").trim() : "";
  }
  if (!record.event) record.event = find(/-\s*(.+?)\s+(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)/i, subject) ||
    find(/Your\s+(.+?)\s+ticket confirmation/i, subject) || find(/Tickets?\s+To\s+(.+?)(?::|$)/i, subject);

  const seats = /Sec\s+([A-Za-z0-9]+),\s*Row\s+([A-Za-z0-9]+),\s*Seat\s+([0-9]+\s*-\s*[0-9]+)/i.exec(body);
  if (seats) {
    record.section = seats[1]; record.row = seats[2]; record.seats = seats[3].replace(/\s/g, "");
  } else {
    record.section = find(/SECTION:?\s*([A-Za-z0-9]+)/i, body);
    record.row = find(/\bROW:?\s*([A-Za-z0-9]+)/i, body);
    record.seats = find(/SEATS?:?\s*([0-9]+\s*-\s*[0-9]+|[A-Za-z0-9]+)/i, body);
  }
  record.qty = find(/Ticket Quantity:?\s*(\d+)/i, body) || find(/(\d+)x?\s*Mobile Ticket/i, body) ||
    find(/(\d+)\s*x\s*(?:Full Price|Reserved|Standard)/i, body);
  if (!record.qty && /^\d+\s*-\s*\d+$/.test(record.seats || "")) {
    const range = record.seats.split("-").map(Number);
    record.qty = String(Math.abs(range[1] - range[0]) + 1);
  }
  record.cost = labelledMoney("Total \\(incl\\. fee\\)", body) || labelledMoney("Total", body);
  const hasPerTicket = /[£$€]\s?[\d.,]+\s*x\s*\d/i.test(body) || /Ticket\(s\):|Face Value|Per Item Fees/i.test(body);
  if (!record.qty || !record.cost || !hasPerTicket) record.status = "Check";
  return record;
}

module.exports = { classifyEmail, cleanDate, labelledMoney, parseLysted, parseTicketmaster, parseViagogo, stripForwarding };
