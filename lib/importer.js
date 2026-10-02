const {
  classifyEmail,
  parseLysted,
  parseTicketmaster,
  parseViagogo
} = require("./email-parsers");

const { fetchRecentEmails } = require("./fastmail");
const { client, sheetId } = require("./sheets");

const IMPORT_TAB = "ImportLog";

const IMPORT_COLUMNS = [
  "Fastmail Message ID",
  "Type",
  "External ID",
  "Received",
  "Imported",
  "Status"
];

async function ensureImportTab(sheets, spreadsheetId) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId
  });

  const exists = (metadata.data.sheets || []).some(
    sheet => sheet.properties.title === IMPORT_TAB
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: IMPORT_TAB
              }
            }
          }
        ]
      }
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${IMPORT_TAB}!A1:F1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [IMPORT_COLUMNS]
      }
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Orders!L1",
    valueInputOption: "RAW",
    requestBody: {
      values: [["Purchase date"]]
    }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Orders!M1",
    valueInputOption: "RAW",
    requestBody: {
      values: [["Currency"]]
    }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Viagogo!J1",
    valueInputOption: "RAW",
    requestBody: {
      values: [["Profit"]]
    }
  });
}

async function values(sheets, spreadsheetId, range) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });

  return response.data.values || [];
}

async function writeUpsert(
  sheets,
  spreadsheetId,
  tab,
  idColumn,
  width,
  records,
  rowForRecord,
  preserveRow
) {
  if (!records.length) {
    return {
      added: 0,
      updated: 0
    };
  }

  const endColumn = String.fromCharCode(64 + width);

  const existing = await values(
    sheets,
    spreadsheetId,
    `${tab}!A:${endColumn}`
  );

  const idToRow = new Map();

  existing.slice(1).forEach((row, index) => {
    const id = String(row[idColumn] || "").trim();

    if (id) {
      idToRow.set(id, {
        number: index + 2,
        row
      });
    }
  });

  const updates = [];
  const appends = [];

  records.forEach(record => {
    const id = String(record.order_id || "").trim();
    const match = idToRow.get(id);

    let row = rowForRecord(record);

    if (match) {
      if (preserveRow) {
        row = preserveRow(row, match.row);
      }

      updates.push({
        range: `${tab}!A${match.number}:${endColumn}${match.number}`,
        values: [row]
      });
    } else {
      appends.push(row);

      idToRow.set(id, {
        number: existing.length + appends.length,
        row
      });
    }
  });

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates
      }
    });
  }

  if (appends.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tab}!A:${endColumn}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: appends
      }
    });
  }

  return {
    added: appends.length,
    updated: updates.length
  };
}

function mergeRecords(messages) {
  const records = new Map();

  messages.forEach(({ record }) => {
    const existing = records.get(record.order_id) || {};

    Object.keys(record).forEach(key => {
      if (record[key] === "" || record[key] == null) {
        return;
      }

      if (
        key === "purchased_at" &&
        existing[key] &&
        String(existing[key]) < String(record[key])
      ) {
        return;
      }

      existing[key] = record[key];
    });

    records.set(record.order_id, existing);
  });

  return [...records.values()];
}

async function upsertSales(
  sheets,
  spreadsheetId,
  tab,
  messages,
  lysted
) {
  const records = mergeRecords(messages);

  return writeUpsert(
    sheets,
    spreadsheetId,
    tab,
    3,
    9,
    records,
    record => [
      record.event || "",
      record.venue || "",
      record.date || "",
      record.order_id || "",
      record.section || "",
      record.row || "",
      record.qty || "",
      record.payout || "",
      lysted ? record.profit || "" : "No"
    ],
    (next, current) => {
      if (!lysted) {
        // Partial notifications must not erase existing sale details.
        for (let column = 0; column < 8; column++) {
          if (
            next[column] === "" ||
            (column < 2 && !usableSaleName(next[column]))
          ) {
            next[column] = current[column] || "";
          }
        }

        // Preserve existing payment/cancellation status.
        if (current[8]) {
          next[8] = current[8];
        }

        // This write ends at column I.
        // Manually entered profit in column J is untouched.
      }

      return next;
    }
  );
}

// Reject empty values and HTML fragments without guessing names.
function usableSaleName(value) {
  const text = String(value == null ? "" : value).trim();

  return (
    Boolean(text) &&
    !/<\/?[a-z][^>]*>/i.test(text) &&
    !/&lt;\/?[a-z][\s\S]*?&gt;/i.test(text) &&
    !/^(?:event|venue)\s*:?$/i.test(text)
  );
}

async function repairViagogoNames(
  sheets,
  spreadsheetId,
  emails
) {
  // Includes emails already marked Imported.
  // A payout is not required to repair an artist or venue.
  const candidates = new Map();

  for (const email of emails) {
    if (classifyEmail(email) !== "viagogo") {
      continue;
    }

    const record = parseViagogo(
      email.subject,
      email.body
    );

    const id = String(record.order_id || "").trim();

    if (!id) {
      continue;
    }

    const candidate = candidates.get(id) || {};

    for (const key of ["event", "venue"]) {
      if (usableSaleName(record[key])) {
        candidate[key] = String(record[key]).trim();
      }
    }

    candidates.set(id, candidate);
  }

  const rows = await values(
    sheets,
    spreadsheetId,
    "Viagogo!A:D"
  );

  const updates = [];

  let repairedRows = 0;
  let unresolvedRows = 0;

  rows.slice(1).forEach((row, index) => {
    const id = String(row[3] || "").trim();

    if (!id) {
      return;
    }

    const candidate = candidates.get(id) || {};

    let repaired = false;
    let unresolved = false;

    ["event", "venue"].forEach((key, column) => {
      // Leave existing valid names alone.
      if (usableSaleName(row[column])) {
        return;
      }

      // No reliable replacement: leave the cell unchanged.
      if (!usableSaleName(candidate[key])) {
        unresolved = true;
        return;
      }

      updates.push({
        range: `Viagogo!${column === 0 ? "A" : "B"}${index + 2}`,
        values: [[candidate[key]]]
      });

      repaired = true;
    });

    if (repaired) {
      repairedRows++;
    }

    if (unresolved) {
      unresolvedRows++;
    }
  });

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates
      }
    });
  }

  return {
    repairedRows,
    repairedCells: updates.length,
    unresolvedRows
  };
}

async function upsertOrders(
  sheets,
  spreadsheetId,
  messages
) {
  const records = mergeRecords(messages);

  return writeUpsert(
    sheets,
    spreadsheetId,
    "Orders",
    8,
    13,
    records,
    record => [
      record.event || "",
      record.date || "",
      record.venue || "",
      record.section || "",
      record.row || "",
      record.seats || "",
      record.qty || "",
      record.cost || "",
      record.order_id || "",
      record.account || "",
      record.status || "",
      record.purchased_at || "",
      record.order_currency || ""
    ],
    (next, current) => {
      if (String(current[10] || "") === "Confirmed") {
        next[10] = "Confirmed";
      }

      if (current[11]) {
        next[11] = current[11];
      }

      if (current[12]) {
        next[12] = current[12];
      }

      return next;
    }
  );
}

function currencySymbol(value) {
  const match = String(value || "").match(/[£$€]/);

  return match ? match[0] : "";
}

function idAppears(text, id) {
  const escaped = String(id).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  return new RegExp(
    `(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`,
    "i"
  ).test(text);
}

async function applyPayments(
  sheets,
  spreadsheetId,
  paymentMessages
) {
  if (!paymentMessages.length) {
    return new Set();
  }

  const rows = await values(
    sheets,
    spreadsheetId,
    "Viagogo!A:I"
  );

  const updates = new Map();
  const matchedMessages = new Set();

  rows.slice(1).forEach((row, index) => {
    const orderId = String(row[3] || "").trim();
    const status = String(row[8] || "");

    if (
      !orderId ||
      status === "Yes" ||
      status === "Cancelled"
    ) {
      return;
    }

    paymentMessages.forEach(({ email }) => {
      if (
        idAppears(
          `${email.subject}\n${email.body}`,
          orderId
        )
      ) {
        updates.set(index + 2, {
          range: `Viagogo!I${index + 2}`,
          values: [["Yes"]]
        });

        matchedMessages.add(email.id);
      }
    });
  });

  if (updates.size) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: [...updates.values()]
      }
    });
  }

  return matchedMessages;
}

async function appendImportLog(
  sheets,
  spreadsheetId,
  rows
) {
  if (!rows.length) {
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${IMPORT_TAB}!A:F`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows
    }
  });
}

async function writeImportLog(
  sheets,
  spreadsheetId,
  existingLog,
  rows
) {
  if (!rows.length) {
    return;
  }

  const idToRow = new Map();

  existingLog.slice(1).forEach((row, index) => {
    const id = String(row[0] || "");

    if (id) {
      idToRow.set(id, index + 2);
    }
  });

  const updates = [];
  const appends = [];

  rows.forEach(row => {
    const rowNumber = idToRow.get(
      String(row[0] || "")
    );

    if (rowNumber) {
      updates.push({
        range: `${IMPORT_TAB}!A${rowNumber}:F${rowNumber}`,
        values: [row]
      });
    } else {
      appends.push(row);
    }
  });

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates
      }
    });
  }

  await appendImportLog(
    sheets,
    spreadsheetId,
    appends
  );
}

async function syncFastmail({
  fetchEmails = fetchRecentEmails,
  sheets = client(
    "https://www.googleapis.com/auth/spreadsheets"
  ),
  spreadsheetId = sheetId()
} = {}) {
  await ensureImportTab(sheets, spreadsheetId);

  const log = await values(
    sheets,
    spreadsheetId,
    `${IMPORT_TAB}!A:F`
  );

  const completedIds = new Set(
    log
      .slice(1)
      .filter(row =>
        ["Imported", "No change"].includes(
          String(row[5] || "")
        )
      )
      .map(row => String(row[0] || ""))
  );

  const days = Number(
    process.env.FASTMAIL_IMPORT_DAYS || 14
  );

  const fetchedEmails = await fetchEmails({ days });

  const emails = fetchedEmails.filter(
    email => !completedIds.has(String(email.id))
  );

  const groups = {
    lysted: [],
    viagogo: [],
    ticketmaster: [],
    payment: []
  };

  const review = [];

  emails.forEach(email => {
    const type = classifyEmail(email);

    if (!type) {
      return;
    }

    if (type === "payment") {
      groups.payment.push({ email });
      return;
    }

    const record =
      type === "lysted"
        ? parseLysted(email.subject, email.body)
        : type === "viagogo"
          ? parseViagogo(email.subject, email.body)
          : parseTicketmaster(
              email.subject,
              email.body,
              email.to
            );

    if (type === "ticketmaster") {
      record.purchased_at = email.receivedAt;
      record.order_currency = currencySymbol(
        record.cost
      );
    }

    const valid =
      type === "ticketmaster"
        ? record.order_id &&
          (record.cost || record.qty)
        : record.order_id && record.payout;

    if (valid) {
      groups[type].push({
        email,
        record
      });
    } else {
      review.push({
        email,
        type,
        record
      });
    }
  });

  // Preserve the existing Ticketmaster replay behaviour.
  fetchedEmails
    .filter(
      email =>
        completedIds.has(String(email.id)) &&
        classifyEmail(email) === "ticketmaster"
    )
    .forEach(email => {
      const record = parseTicketmaster(
        email.subject,
        email.body,
        email.to
      );

      record.purchased_at = email.receivedAt;
      record.order_currency = currencySymbol(
        record.cost
      );

      if (
        record.order_id &&
        (record.cost || record.qty)
      ) {
        groups.ticketmaster.push({
          email,
          record,
          replayed: true
        });
      }
    });

  const [lysted, viagogo, orders] = await Promise.all([
    upsertSales(
      sheets,
      spreadsheetId,
      "Sheet1",
      groups.lysted,
      true
    ),
    upsertSales(
      sheets,
      spreadsheetId,
      "Viagogo",
      groups.viagogo,
      false
    ),
    upsertOrders(
      sheets,
      spreadsheetId,
      groups.ticketmaster
    )
  ]);

  // Repair only artist and venue cells.
  // Completed Viagogo emails are not replayed through
  // the financial upsert.
  const viagogoNameRepair = await repairViagogoNames(
    sheets,
    spreadsheetId,
    fetchedEmails
  );

  const matchedPayments = await applyPayments(
    sheets,
    spreadsheetId,
    groups.payment
  );

  const importedAt = new Date().toISOString();
  const logRows = [];

  ["lysted", "viagogo", "ticketmaster"].forEach(type => {
    groups[type].forEach(({ email, record }) => {
      logRows.push([
        email.id,
        type,
        record.order_id,
        email.receivedAt,
        importedAt,
        "Imported"
      ]);
    });
  });

  groups.payment.forEach(({ email }) => {
    logRows.push([
      email.id,
      "payment",
      "",
      email.receivedAt,
      importedAt,
      matchedPayments.has(email.id)
        ? "Imported"
        : "Review"
    ]);
  });

  review.forEach(({ email, type }) => {
    logRows.push([
      email.id,
      type,
      "",
      email.receivedAt,
      importedAt,
      "Review"
    ]);
  });

  await writeImportLog(
    sheets,
    spreadsheetId,
    log,
    logRows
  );

  return {
    scanned: emails.length,

    mailAccountsChecked:
      Number(fetchedEmails.mailAccountsChecked) || 1,

    mailboxMessagesChecked:
      Number(fetchedEmails.mailboxMessagesChecked) ||
      fetchedEmails.length,

    imported:
      groups.lysted.length +
      groups.viagogo.length +
      groups.ticketmaster.filter(
        message => !message.replayed
      ).length +
      matchedPayments.size,

    review:
      review.length +
      groups.payment.length -
      matchedPayments.size,

    lysted,
    viagogo,
    orders,

    paymentsMatched: matchedPayments.size,
    viagogoNameRepair
  };
}

module.exports = {
  applyPayments,
  currencySymbol,
  idAppears,
  mergeRecords,
  syncFastmail,
  writeImportLog,
  writeUpsert,
  repairViagogoNames,
  usableSaleName
};
