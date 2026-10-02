const {
  classifyEmail,
  parseLysted,
  parseTicketmaster,
  parseViagogo
} = require("./email-parsers");

const { fetchRecentEmails } = require("./fastmail");
const { client, sheetId } = require("./sheets");
const { withSheetLock } = require("./sheet-lock");
const { purchaseTimestamp } = require("./purchase-date");
const { parseMoney } = require("./utils");

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
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(title)" });
  const exists = (metadata.data.sheets || []).some(sheet => sheet.properties.title === IMPORT_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: {
      requests: [{ addSheet: { properties: { title: IMPORT_TAB } } }]
    } });
  }
  const headers = [
    ["ImportLog!A1:F1", IMPORT_COLUMNS],
    ["Orders!L1:M1", ["Purchase date", "Currency"]],
    ["Viagogo!J1:K1", ["Profit", "Currency"]],
    ["Sheet1!J1", ["Currency"]]
  ];
  const result = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: headers.map(([range]) => range) });
  const data = [];
  headers.forEach(([range, expected], index) => {
    const current = result.data.valueRanges[index].values?.[0] || [];
    expected.forEach((value, column) => {
      if (current[column] && current[column] !== value) {
        throw new Error(`Reserved import header conflict in ${range}; preserve the existing column and review the sheet layout.`);
      }
    });
    if (expected.some((value, column) => current[column] !== value)) data.push({ range, values: [expected] });
  });
  if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId,
    requestBody: { valueInputOption: "RAW", data } });
}

async function values(sheets, spreadsheetId, range) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "FORMULA"
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
  preserveRow,
  existingRows
) {
  if (!records.length) {
    return {
      added: 0,
      updated: 0,
      unchanged: 0
    };
  }

  const endColumn = String.fromCharCode(64 + width);

  const existing = existingRows || await values(sheets, spreadsheetId, `${tab}!A:${endColumn}`);

  const idToRow = new Map();

  existing.slice(1).forEach((row, index) => {
    const id = String(row[idColumn] || "").trim();

    if (id) {
      if (idToRow.has(id)) throw new Error(`Duplicate order IDs in ${tab}; review existing rows before importing.`);
      idToRow.set(id, { number: index + 2, row });
    }
  });

  const updates = [];
  const appends = [];
  let updated = 0;
  let unchanged = 0;

  records.forEach(record => {
    const id = String(record.order_id || "").trim();
    const match = idToRow.get(id);

    let row = rowForRecord(record);

    if (match) {
      if (preserveRow) {
        row = preserveRow(row, match.row, record);
      }

      const changed = row.map((value, column) => ({ value, column }))
        .filter(({ value, column }) => value !== (match.row[column] ?? ""));
      if (match.pending) {
        appends[match.pending - 1] = row;
      } else {
        changed.forEach(({ value, column }) => updates.push({
          range: `${tab}!${String.fromCharCode(65 + column)}${match.number}`,
          values: [[value]]
        }));
        if (changed.length) updated++; else unchanged++;
      }
      match.row = row;
      if (!match.pending) existing[match.number - 1] = row;
    } else {
      appends.push(row);

      idToRow.set(id, {
        number: existing.length + appends.length,
        pending: appends.length,
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

  existing.push(...appends);
  return {
    added: appends.length,
    updated,
    unchanged
  };
}

function mergeRecords(messages) {
  const records = new Map();

  // Oldest to newest: the newest nonempty detail wins, regardless of input order.
  [...messages].sort((left, right) => String(left.email?.receivedAt || "")
    .localeCompare(String(right.email?.receivedAt || ""))).forEach(({ record }) => {
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
  lysted,
  existingRows
) {
  const records = mergeRecords(messages);

  return writeUpsert(
    sheets,
    spreadsheetId,
    tab,
    3,
    lysted ? 10 : 11,
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
      ...(lysted ? [record.profit || "", currencySymbol(record.payout)]
        : ["No", "", currencySymbol(record.payout)])
    ],
    (next, current, record) => {
      // Keep financial history and manual edits; only fill missing details.
      next.forEach((value, column) => {
        if (current[column] !== "" && current[column] != null) next[column] = current[column];
      });
      const currencyColumn = lysted ? 9 : 10;
      if (!current[currencyColumn] && record.payout && current[7] !== "" && current[7] != null) {
        const incoming = parseMoney(record.payout);
        const existing = String(current[7]).startsWith("=") ? null : parseMoney(current[7], incoming?.cur);
        if (!incoming || !existing || incoming.amt !== existing.amt || incoming.cur !== existing.cur) next[currencyColumn] = "";
      }
      if (!lysted) {
        for (const column of [0, 1]) {
          if (!usableSaleName(next[column])) next[column] = current[column] || "";
        }
        // Never touch manually entered Viagogo profit, including an intentional blank.
        next[9] = current[9] ?? "";
      }

      return next;
    },
    existingRows
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
  emails,
  existingRows
) {
  // Includes emails already marked Imported.
  // A payout is not required to repair an artist or venue.
  const candidates = new Map();

  for (const email of [...emails].sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")))) {
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
      if (!candidate[key] && usableSaleName(record[key])) {
        candidate[key] = String(record[key]).trim();
      }
    }

    candidates.set(id, candidate);
  }

  const rows = existingRows || await values(sheets, spreadsheetId, "Viagogo!A:D");

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
  messages,
  existingRows
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
    (next, current, record) => {
      next.forEach((value, column) => {
        if (current[column] !== "" && current[column] != null) next[column] = current[column];
      });
      if (!current[12] && record.cost && current[7] !== "" && current[7] != null) {
        const incoming = parseMoney(record.cost);
        const existing = String(current[7]).startsWith("=") ? null : parseMoney(current[7], incoming?.cur);
        if (!incoming || !existing || incoming.amt !== existing.amt || incoming.cur !== existing.cur) next[12] = "";
      }
      // Confirmed quantities must remain untouched even when intentionally blank.
      if (current[10] === "Confirmed") next[6] = current[6] ?? "";

      return next;
    },
    existingRows
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
  paymentMessages,
  existingRows
) {
  if (!paymentMessages.length) {
    return new Set();
  }

  const rows = existingRows || await values(sheets, spreadsheetId, "Viagogo!A:I");

  const updates = new Map();
  const matchedMessages = new Set();

  const idToRows = new Map();
  rows.slice(1).forEach((row, index) => {
    const id = String(row[3] || "").trim().toUpperCase();
    if (!id) return;
    if (!idToRows.has(id)) idToRows.set(id, []);
    idToRows.get(id).push({ row, number: index + 2 });
  });
  for (const { email } of paymentMessages) {
    const ids = new Set(`${email.subject}\n${email.body}`.toUpperCase().match(/[A-Z0-9]+(?:[-/][A-Z0-9]+)*/g) || []);
    for (const id of ids) {
      for (const { row, number } of idToRows.get(id) || []) {
        const status = String(row[8] || "").trim();
        if (status.startsWith("=")) continue;
        if (!["yes", "paid", "cancelled"].includes(status.toLowerCase())) {
          updates.set(number, { range: `Viagogo!I${number}`, values: [["Yes"]] });
        }
        matchedMessages.add(email.id);
      }
    }
  }

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

  [...new Map(rows.map(row => [String(row[0] || ""), row])).values()].forEach(row => {
    const rowNumber = idToRow.get(
      String(row[0] || "")
    );

    if (rowNumber) {
      if (row.every((value, column) => value === (existingLog[rowNumber - 1][column] ?? ""))) return;
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

async function backfillSaleCurrencies(sheets, spreadsheetId, emails, tables) {
  const candidates = new Map();
  for (const email of [...emails].sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))) {
    const type = classifyEmail(email);
    if (!["lysted", "viagogo"].includes(type)) continue;
    const record = type === "lysted" ? parseLysted(email.subject, email.body) : parseViagogo(email.subject, email.body);
    const key = `${type}:${record.order_id}`;
    if (!candidates.has(key) && currencySymbol(record.payout)) candidates.set(key, record);
  }
  const data = [];
  for (const [type, tab, rows, column] of [["lysted", "Sheet1", tables.lysted, 9], ["viagogo", "Viagogo", tables.viagogo, 10]]) {
    rows.slice(1).forEach((row, index) => {
      if (row[column]) return;
      const record = candidates.get(`${type}:${String(row[3] || "").trim()}`);
      if (!record) return;
      const payout = parseMoney(record.payout);
      if (String(row[7] || "").startsWith("=")) return;
      const current = parseMoney(row[7], payout.cur);
      if (!current || current.amt !== payout.amt || current.cur !== payout.cur) return;
      data.push({ range: `${tab}!${String.fromCharCode(65 + column)}${index + 2}`, values: [[payout.cur]] });
      row[column] = payout.cur;
    });
  }
  if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId,
    requestBody: { valueInputOption: "RAW", data } });
  return data.length;
}

async function syncUnlocked({
  fetchEmails = fetchRecentEmails,
  sheets = client(
    "https://www.googleapis.com/auth/spreadsheets"
  ),
  spreadsheetId = sheetId()
} = {}) {
  await ensureImportTab(sheets, spreadsheetId);

  const snapshot = await sheets.spreadsheets.values.batchGet({ spreadsheetId,
    ranges: ["ImportLog!A:F", "Orders!A:M", "Sheet1!A:J", "Viagogo!A:K"],
    valueRenderOption: "FORMULA"
  });
  const [log, orderRows, lystedRows, viagogoRows] = snapshot.data.valueRanges.map(range => range.values || []);
  for (const [tab, rows, idColumn] of [["Orders", orderRows, 8], ["Sheet1", lystedRows, 3], ["Viagogo", viagogoRows, 3]]) {
    const ids = new Set();
    for (const row of rows.slice(1)) {
      const id = String(row[idColumn] || "").trim();
      if (!id) continue;
      if (ids.has(id)) throw new Error(`Duplicate order IDs in ${tab}; review existing rows before importing.`);
      ids.add(id);
    }
  }

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
      record.purchased_at = purchaseTimestamp(email);
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

      record.purchased_at = purchaseTimestamp(email);
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

  const writes = await Promise.allSettled([
    upsertSales(
      sheets,
      spreadsheetId,
      "Sheet1",
      groups.lysted,
      true,
      lystedRows
    ),
    upsertSales(
      sheets,
      spreadsheetId,
      "Viagogo",
      groups.viagogo,
      false,
      viagogoRows
    ),
    upsertOrders(
      sheets,
      spreadsheetId,
      groups.ticketmaster,
      orderRows
    )
  ]);
  // Keep the lock until every started write settles, even when one tab fails.
  const failedWrite = writes.find(result => result.status === "rejected");
  if (failedWrite) throw failedWrite.reason;
  const [lysted, viagogo, orders] = writes.map(result => result.value);

  // Repair only artist and venue cells.
  // Completed Viagogo emails are not replayed through
  // the financial upsert.
  const viagogoNameRepair = await repairViagogoNames(
    sheets,
    spreadsheetId,
    fetchedEmails,
    viagogoRows
  );

  const currenciesBackfilled = await backfillSaleCurrencies(sheets, spreadsheetId, fetchedEmails,
    { lysted: lystedRows, viagogo: viagogoRows });

  const matchedPayments = await applyPayments(
    sheets,
    spreadsheetId,
    groups.payment,
    viagogoRows
  );

  const importedAt = new Date().toISOString();
  const logRows = [];

  ["lysted", "viagogo", "ticketmaster"].forEach(type => {
    groups[type].forEach(({ email, record }) => {
      if (completedIds.has(String(email.id))) return;
      logRows.push([email.id, type, record.order_id,
        type === "ticketmaster" ? record.purchased_at : email.receivedAt,
        importedAt, type === "ticketmaster" && !record.purchased_at ? "Review" : "Imported"]);
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
    scanComplete: fetchedEmails.scanComplete !== false,
    warnings: fetchedEmails.warnings || [],

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
      review.length + groups.ticketmaster.filter(({ record }) => !record.purchased_at).length +
      groups.payment.length -
      matchedPayments.size,

    lysted,
    viagogo,
    orders,

    paymentsMatched: matchedPayments.size,
    viagogoNameRepair,
    currenciesBackfilled
  };
}

async function syncFastmail(options = {}) {
  const sheets = options.sheets || client("https://www.googleapis.com/auth/spreadsheets");
  const spreadsheetId = options.spreadsheetId || sheetId();
  return withSheetLock(sheets, spreadsheetId, () => syncUnlocked({ ...options, sheets, spreadsheetId }));
}

module.exports = {
  backfillSaleCurrencies,
  ensureImportTab,
  upsertOrders,
  upsertSales,
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
