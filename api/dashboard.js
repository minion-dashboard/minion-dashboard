const { google } = require("googleapis");

// Main spreadsheet (miniontickets)
const MAIN_SHEET_ID = "1HCAL0ei_RrxpIdoPC_IY_qzhPTsukwaTGBnIf8lZJQo";
const LYSTED_TAB = "Sheet1";
const VIAGOGO_TAB = "Viagogo";
// Optional extras via Vercel environment variables:
//   HISTORY_SHEET_ID - the Viagogo Sales History sheet's ID
//   PASSWORD         - if set, the dashboard asks for it (username: any)

function sumMoney(values) {
  const t = {};
  for (let v of values) {
    v = String(v || "").trim();
    if (!v) continue;
    const neg = v.includes("-");
    const cur = (v.match(/[£$€]/) || ["$"])[0];
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    if (isNaN(n)) continue;
    t[cur] = (t[cur] || 0) + (neg ? -n : n);
  }
  const parts = Object.keys(t).map(
    (c) => c + t[c].toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  );
  return parts.join("  ") || "-";
}

function tabStats(rows, hasProfit, hasPaid) {
  const data = (rows || []).slice(1).filter((r) => (r[3] || "").toString().trim());
  const recent = data.slice(-8).reverse().map((r) => ({
    event: r[0] || "", date: fmtDate(r[2]), qty: r[6] || "", payout: r[7] || "",
    paid: hasPaid ? (r[8] || "") : null,
  }));
  const out = {
    count: data.length,
    payout: sumMoney(data.map((r) => r[7])),
    profit: hasProfit ? sumMoney(data.map((r) => r[8])) : null,
    recent,
  };
  if (hasPaid) {
    out.paid = data.filter((r) => r[8] === "Yes").length;
    out.unpaid = data.filter((r) => r[8] === "No").length;
  }
  return out;
}

const OVERDUE_DAYS = 10;

function serialToDate(n) {
  // Google Sheets date serial: days since 30 Dec 1899
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000);
}

function fmtDate(v) {
  if (typeof v === "number") {
    const d = serialToDate(v);
    const p = (x) => (x < 10 ? "0" : "") + x;
    const hm = d.getUTCHours() || d.getUTCMinutes()
      ? " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) : "";
    return p(d.getUTCDate()) + "/" + p(d.getUTCMonth() + 1) + "/" + d.getUTCFullYear() + hm;
  }
  return String(v || "");
}

function cellToDate(v) {
  if (typeof v === "number") return serialToDate(v);
  return parseDdMmYyyy(v);
}

function parseDdMmYyyy(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || "").trim());
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

function collectOverdue(rows) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - OVERDUE_DAYS);
  return (rows || []).slice(1)
    .filter((r) => (r[3] || "").toString().trim() && r[8] === "No")
    .filter((r) => { const d = cellToDate(r[2]); return d && d < cutoff; })
    .map((r) => ({ event: r[0] || "", date: fmtDate(r[2]), order: r[3] || "", payout: r[7] || "" }));
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function card(n, label) {
  return `<div class="card"><div class="n">${esc(n)}</div><div class="l">${esc(label)}</div></div>`;
}

function table(recent) {
  const hasPaid = recent.some((r) => r.paid !== null && r.paid !== undefined);
  const rows = recent.map((r) =>
    `<tr><td>${esc(r.event)}</td><td>${esc(r.date)}</td><td>${esc(r.qty)}</td><td>${esc(r.payout)}</td>` +
    (hasPaid ? `<td>${esc(r.paid || "")}</td>` : "") + `</tr>`
  ).join("");
  return `<table><tr><th>Event</th><th>Date</th><th>Qty</th><th>Payout</th>` +
    (hasPaid ? `<th>Paid</th>` : "") + `</tr>${rows}</table>`;
}

function render(lysted, viagogo, overdue) {
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Minion Tickets</title><style>
body{font-family:Segoe UI,Arial,sans-serif;background:#0f1420;margin:0;padding:20px;color:#e8ecf3}
h1{font-size:24px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 10px;color:#9fb0c8;text-transform:uppercase;letter-spacing:.08em}
.sub{color:#7787a0;font-size:13px;margin-bottom:8px}
.cards{display:flex;flex-wrap:wrap;gap:12px}
.card{background:#1a2233;border-radius:12px;padding:16px 20px;min-width:150px;box-shadow:0 2px 8px rgba(0,0,0,.35)}
.card .n{font-size:22px;font-weight:600}.card .l{font-size:12px;color:#8b9bb5;margin-top:2px}
table{width:100%;border-collapse:collapse;background:#1a2233;border-radius:12px;overflow:hidden}
td,th{padding:9px 12px;font-size:13px;text-align:left;border-bottom:1px solid #26314a}
th{color:#8b9bb5;font-weight:600}tr:last-child td{border-bottom:none}
.foot{color:#556381;font-size:12px;margin-top:26px}
.alert{background:#3a1f24;border:1px solid #7a3540;border-radius:12px;padding:14px 18px;margin:18px 0;color:#ffd9de}
.alert table{background:#2c181d}.alert td,.alert th{border-bottom:1px solid #4a262e}
</style></head><body>
<h1>Minion Tickets</h1><div class="sub">Live sales dashboard</div>
${overdue && overdue.length ? `<div class="alert"><b>&#9888; ${overdue.length} overdue payment${overdue.length > 1 ? "s" : ""}</b> - unpaid more than ${OVERDUE_DAYS} days after the event:
<table style="margin-top:10px"><tr><th>Event</th><th>Event date</th><th>Order</th><th>Amount</th></tr>
${overdue.map((o) => `<tr><td>${esc(o.event)}</td><td>${esc(o.date)}</td><td>${esc(o.order)}</td><td>${esc(o.payout)}</td></tr>`).join("")}
</table></div>` : ""}
<h2>Lysted</h2><div class="cards">
${card(lysted.count, "Sales")}${card(lysted.payout, "Total payout")}${card(lysted.profit, "Total profit")}
</div>
<h2>Recent Lysted sales</h2>${table(lysted.recent)}
<h2>Viagogo (all time)</h2><div class="cards">
${card(viagogo.count, "Sales")}${card(viagogo.payout, "Total payout")}${viagogo.paid !== undefined ? card(viagogo.paid, "Paid") + card(viagogo.unpaid, "Not yet paid") : ""}
</div>
<h2>Recent Viagogo sales</h2>${table(viagogo.recent)}
<div class="foot">Data live from Google Sheets &middot; refresh any time.</div>
</body></html>`;
}

module.exports = async (req, res) => {
  // Optional password gate (HTTP Basic auth)
  if (process.env.PASSWORD) {
    const auth = req.headers.authorization || "";
    const expected = Buffer.from(":" + process.env.PASSWORD).toString("base64");
    const ok = auth.startsWith("Basic ") &&
      Buffer.from(auth.slice(6), "base64").toString().split(":").pop() === process.env.PASSWORD;
    if (!ok) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Minion Tickets"');
      return res.status(401).send("Password required");
    }
  }

  try {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.JWT(creds.client_email, null, creds.private_key,
      ["https://www.googleapis.com/auth/spreadsheets.readonly"]);
    const sheets = google.sheets({ version: "v4", auth });

    const main = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: MAIN_SHEET_ID,
      ranges: [`${LYSTED_TAB}!A:I`, `${VIAGOGO_TAB}!A:I`],
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const lysted = tabStats(main.data.valueRanges[0].values, true);
    const viagogo = tabStats(main.data.valueRanges[1].values, false, true);

    const overdue = collectOverdue(main.data.valueRanges[1].values);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(render(lysted, viagogo, overdue));
  } catch (e) {
    return res.status(500).send(
      "Dashboard error: " + esc(e.message) +
      "<br><br>Check the GOOGLE_CREDENTIALS environment variable and that both sheets are shared with the service account email."
    );
  }
};
