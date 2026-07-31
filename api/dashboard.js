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

function tabStats(rows, hasProfit) {
  const data = (rows || []).slice(1).filter((r) => (r[3] || "").toString().trim());
  const recent = data.slice(-8).reverse().map((r) => ({
    event: r[0] || "", date: r[2] || "", qty: r[6] || "", payout: r[7] || "",
  }));
  return {
    count: data.length,
    payout: sumMoney(data.map((r) => r[7])),
    profit: hasProfit ? sumMoney(data.map((r) => r[8])) : null,
    recent,
  };
}

function historyStats(rows) {
  const data = (rows || []).slice(1).filter((r) => (r[3] || "").toString().trim());
  const paid = data.filter((r) => r[8] === "Yes").length;
  return { count: data.length, paid, unpaid: data.length - paid };
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function card(n, label) {
  return `<div class="card"><div class="n">${esc(n)}</div><div class="l">${esc(label)}</div></div>`;
}

function table(recent) {
  const rows = recent.map((r) =>
    `<tr><td>${esc(r.event)}</td><td>${esc(r.date)}</td><td>${esc(r.qty)}</td><td>${esc(r.payout)}</td></tr>`
  ).join("");
  return `<table><tr><th>Event</th><th>Date</th><th>Qty</th><th>Payout</th></tr>${rows}</table>`;
}

function render(lysted, viagogo, hist) {
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
</style></head><body>
<h1>Minion Tickets</h1><div class="sub">Live sales dashboard</div>
<h2>Lysted</h2><div class="cards">
${card(lysted.count, "Sales")}${card(lysted.payout, "Total payout")}${card(lysted.profit, "Total profit")}
</div>
<h2>Recent Lysted sales</h2>${table(lysted.recent)}
<h2>Viagogo</h2><div class="cards">
${card(viagogo.count, "Sales")}${card(viagogo.payout, "Total payout")}
</div>
<h2>Recent Viagogo sales</h2>${table(viagogo.recent)}
${hist ? `<h2>Viagogo history (since Jul 2025)</h2><div class="cards">
${card(hist.count, "Sales")}${card(hist.paid, "Paid")}${card(hist.unpaid, "Not yet paid")}
</div>` : ""}
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
      ranges: [`${LYSTED_TAB}!A:I`, `${VIAGOGO_TAB}!A:H`],
    });
    const lysted = tabStats(main.data.valueRanges[0].values, true);
    const viagogo = tabStats(main.data.valueRanges[1].values, false);

    let hist = null;
    if (process.env.HISTORY_SHEET_ID) {
      try {
        const h = await sheets.spreadsheets.values.get({
          spreadsheetId: process.env.HISTORY_SHEET_ID, range: "Viagogo!A:I",
        });
        hist = historyStats(h.data.values);
      } catch (e) { hist = null; }
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(render(lysted, viagogo, hist));
  } catch (e) {
    return res.status(500).send(
      "Dashboard error: " + esc(e.message) +
      "<br><br>Check the GOOGLE_CREDENTIALS environment variable and that both sheets are shared with the service account email."
    );
  }
};
