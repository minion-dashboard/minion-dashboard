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

function collectOverdue(rawRows, fmtRows) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - OVERDUE_DAYS);
  const out = [];
  (rawRows || []).slice(1).forEach((r, i) => {
    if (!(r[3] || "").toString().trim() || r[8] !== "No") return;
    const d = cellToDate(r[2]);
    if (!d || d >= cutoff) return;
    const f = (fmtRows || [])[i + 1] || r;  // formatted twin row for display
    out.push({ event: f[0] || "", date: fmtDate(f[2]), order: String(f[3] || ""), payout: f[7] || "" });
  });
  return out;
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
*{box-sizing:border-box}
body{font-family:Segoe UI,Arial,sans-serif;margin:0;padding:22px;color:#eef0ff;
background:#0a0a14;min-height:100vh;position:relative}
body::before{content:"";position:fixed;inset:0;z-index:-1;background:
radial-gradient(600px 500px at 12% 8%,rgba(139,124,247,.42),transparent 60%),
radial-gradient(700px 600px at 88% 20%,rgba(56,189,248,.30),transparent 60%),
radial-gradient(700px 700px at 45% 95%,rgba(217,70,239,.26),transparent 60%),
#0a0a14}
.top{background:rgba(255,255,255,.07);backdrop-filter:blur(22px) saturate(160%);
-webkit-backdrop-filter:blur(22px) saturate(160%);
border:1px solid rgba(255,255,255,.16);border-radius:20px;padding:18px 24px;
display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;
box-shadow:0 8px 32px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.18)}
h1{font-size:26px;margin:0;font-weight:800;letter-spacing:.5px;
background:linear-gradient(90deg,#e6dcff,#a8b8ff);-webkit-background-clip:text;background-clip:text;color:transparent;
text-shadow:0 0 30px rgba(160,150,255,.35)}
.badge{border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);
color:#cfd2f4;font-size:11px;padding:6px 12px;border-radius:999px;letter-spacing:.12em;text-transform:uppercase}
.panel{background:rgba(255,255,255,.06);backdrop-filter:blur(22px) saturate(160%);
-webkit-backdrop-filter:blur(22px) saturate(160%);
border:1px solid rgba(255,255,255,.14);border-radius:20px;margin-bottom:18px;overflow:hidden;
box-shadow:0 8px 32px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.14)}
.phead{padding:13px 20px;border-bottom:1px solid rgba(255,255,255,.10);font-size:12px;font-weight:700;
letter-spacing:.14em;text-transform:uppercase;color:#c3c6ea}
.pbody{padding:16px 20px}
.cards{display:flex;flex-wrap:wrap;gap:12px}
.card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);
border-radius:16px;padding:14px 20px;min-width:150px;
box-shadow:inset 0 1px 0 rgba(255,255,255,.16)}
.card .n{font-size:22px;font-weight:700;color:#dcd6ff;text-shadow:0 0 18px rgba(160,150,255,.45)}
.card .l{font-size:11px;color:#a7abd6;margin-top:3px;letter-spacing:.08em;text-transform:uppercase}
table{width:100%;border-collapse:collapse}
td,th{padding:9px 12px;font-size:13px;text-align:left;border-bottom:1px solid rgba(255,255,255,.09)}
th{color:#a7abd6;font-size:11px;letter-spacing:.1em;text-transform:uppercase}
tr:last-child td{border-bottom:none}
.alert{background:rgba(255,80,120,.10);backdrop-filter:blur(22px) saturate(160%);
-webkit-backdrop-filter:blur(22px) saturate(160%);
border:1px solid rgba(255,120,150,.35);border-radius:20px;margin-bottom:18px;overflow:hidden;
box-shadow:0 8px 32px rgba(120,0,40,.25),inset 0 1px 0 rgba(255,255,255,.12)}
.alert .phead{color:#ffb3c8;border-bottom:1px solid rgba(255,120,150,.22)}
.alert td,.alert th{border-bottom:1px solid rgba(255,120,150,.16)}
.foot{color:#8286b4;font-size:12px;margin-top:8px}
</style></head><body>
<div class="top"><h1>MINION TICKETS</h1><div class="badge">Live dashboard</div></div>
${overdue && overdue.length ? `<div class="alert"><div class="phead">&#9888; ${overdue.length} overdue payment${overdue.length > 1 ? "s" : ""} - unpaid ${OVERDUE_DAYS}+ days after the event</div><div class="pbody">
<table><tr><th>Event</th><th>Event date</th><th>Order</th><th>Amount</th></tr>
${overdue.map((o) => `<tr><td>${esc(o.event)}</td><td>${esc(o.date)}</td><td>${esc(o.order)}</td><td>${esc(o.payout)}</td></tr>`).join("")}
</table></div></div>` : ""}
<div class="panel"><div class="phead">Lysted</div><div class="pbody">
<div class="cards">${card(lysted.count, "Sales")}${card(lysted.payout, "Total payout")}${card(lysted.profit, "Total profit")}</div>
<h2 style="display:none"></h2>
<div style="height:16px"></div>
${table(lysted.recent)}
</div></div>
<div class="panel"><div class="phead">Viagogo (all time)</div><div class="pbody">
<div class="cards">${card(viagogo.count, "Sales")}${card(viagogo.payout, "Total payout")}${viagogo.paid !== undefined ? card(viagogo.paid, "Paid") + card(viagogo.unpaid, "Not yet paid") : ""}</div>
<div style="height:16px"></div>
${table(viagogo.recent)}
</div></div>
<div class="foot">Data live from your sheets &middot; refresh any time.</div>
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

    const ranges = [`${LYSTED_TAB}!A:I`, `${VIAGOGO_TAB}!A:I`];
    const [fmt, raw] = await Promise.all([
      sheets.spreadsheets.values.batchGet({ spreadsheetId: MAIN_SHEET_ID, ranges }),
      sheets.spreadsheets.values.batchGet({
        spreadsheetId: MAIN_SHEET_ID, ranges, valueRenderOption: "UNFORMATTED_VALUE",
      }),
    ]);
    const lysted = tabStats(fmt.data.valueRanges[0].values, true);
    const viagogo = tabStats(fmt.data.valueRanges[1].values, false, true);

    const overdue = collectOverdue(raw.data.valueRanges[1].values, fmt.data.valueRanges[1].values);

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
