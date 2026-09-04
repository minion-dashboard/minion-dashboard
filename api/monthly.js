const { buildGroups, summarise, tokens } = require("../lib/finance");
const { buildMonthly, isTrackedPurchase, monthKey } = require("../lib/monthly");
const { authenticate } = require("../lib/security");
const { client, sheetId } = require("../lib/sheets");
const { dayKey, esc, pairedRows, parseMoney } = require("../lib/utils");

function card(value, label) {
  return `<div class="card"><div class="n">${esc(value)}</div><div class="l">${esc(label)}</div></div>`;
}

function render(months, now = new Date()) {
  const currentKey = monthKey(now.toISOString());
  const current = months.find(month => month.key === currentKey) || {
    orders: 0, tickets: 0, spendText: "-", profitText: "-"
  };
  const rows = months.map(month => `<tr class="${month.key ? "" : "unknown"}">
    <td>${esc(month.label)}</td><td>${month.orders}</td><td>${month.tickets}</td>
    <td>${esc(month.spendText)}</td><td class="${month.profitValue === null ? "" : month.profitValue < 0 ? "neg" : "pos"}">${esc(month.profitText)}</td>
    <td>${month.reviewEvents || "-"}</td></tr>`).join("");

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Minion Tickets - Monthly</title><style>
*{box-sizing:border-box}body{font-family:Segoe UI,Arial,sans-serif;margin:0;padding:22px;color:#eef0ff;background:#0a0a14;min-height:100vh;position:relative}
body::before{content:"";position:fixed;inset:0;z-index:-1;background:radial-gradient(600px 500px at 12% 8%,rgba(139,124,247,.42),transparent 60%),radial-gradient(700px 600px at 88% 20%,rgba(56,189,248,.30),transparent 60%),radial-gradient(700px 700px at 45% 95%,rgba(217,70,239,.26),transparent 60%),#0a0a14}
.top{background:rgba(255,255,255,.07);backdrop-filter:blur(22px) saturate(160%);-webkit-backdrop-filter:blur(22px) saturate(160%);border:1px solid rgba(255,255,255,.16);border-radius:20px;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;box-shadow:0 8px 32px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.18);gap:12px;flex-wrap:wrap}
h1{font-size:24px;margin:0;font-weight:800;letter-spacing:.5px;background:linear-gradient(90deg,#e6dcff,#a8b8ff);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:0 0 30px rgba(160,150,255,.35)}
a.nav{color:#cfd2f4;text-decoration:none;font-size:13px;border:1px solid rgba(255,255,255,.22);padding:6px 14px;border-radius:999px;background:rgba(255,255,255,.06);margin-left:8px}
.panel{background:rgba(255,255,255,.06);backdrop-filter:blur(22px) saturate(160%);-webkit-backdrop-filter:blur(22px) saturate(160%);border:1px solid rgba(255,255,255,.14);border-radius:20px;margin-bottom:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.14)}
.phead{padding:13px 20px;border-bottom:1px solid rgba(255,255,255,.10);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#c3c6ea}.pbody{padding:6px 8px;overflow-x:auto}
.cards{display:flex;flex-wrap:wrap;gap:12px;padding:14px}.card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:14px 20px;min-width:160px;box-shadow:inset 0 1px 0 rgba(255,255,255,.16)}
.card .n{font-size:22px;font-weight:700;color:#dcd6ff;text-shadow:0 0 18px rgba(160,150,255,.45)}.card .l{font-size:11px;color:#a7abd6;margin-top:3px;letter-spacing:.08em;text-transform:uppercase}
table{width:100%;border-collapse:collapse;min-width:680px}td,th{padding:11px 12px;font-size:14px;text-align:left;border-bottom:1px solid rgba(255,255,255,.09)}th{color:#a7abd6;font-size:11px;letter-spacing:.1em;text-transform:uppercase}tr:last-child td{border-bottom:none}
.pos{color:#9be7b4}.neg{color:#ff9dbb}.unknown td{background:rgba(240,180,90,.08);color:#f3d39a}.foot{color:#9296bf;font-size:12px;line-height:1.5;margin-top:8px}
@media(max-width:700px){body{padding:12px}.top{padding:16px}.card{min-width:calc(50% - 6px);padding:12px}.card .n{font-size:19px}}
</style></head><body>
<div class="top"><h1>MONTHLY PERFORMANCE</h1><div><a class="nav" href="/">Sales</a><a class="nav" href="/orders">Orders</a><a class="nav" href="/pnl">P&amp;L</a><a class="nav" href="/costs">Costs</a></div></div>
<div class="panel"><div class="phead">This month</div><div class="cards">${card(current.orders,"Orders placed")}${card(current.tickets,"Tickets bought")}${card(current.spendText,"Purchase spend")}${card(current.profitText,"Realised profit")}</div></div>
<div class="panel"><div class="phead">Performance by purchase month &middot; September 2026 onward</div><div class="pbody"><table><tr><th>Purchase month</th><th>Orders</th><th>Tickets</th><th>Spend</th><th>Realised profit</th><th>Events to review</th></tr>${rows || '<tr><td colspan="6" style="padding:18px;color:#8286b4">No purchases have been tracked since September 2026.</td></tr>'}</table></div></div>
<div class="foot">Tracking starts on 1 September 2026. Months use the date each Ticketmaster confirmation reached Fastmail. Profit is the current realised profit from those purchases, not the date the sale was paid. When one event was purchased across multiple months, profit is allocated in proportion to purchase cost.</div>
</body></html>`;
}

module.exports = async (req, res) => {
  if (!authenticate(req, res)) return;
  try {
    const sheets = client();
    const spreadsheetId = sheetId();
    const ranges = ["Orders!A:L", "Sheet1!A:I", "Viagogo!A:I"];
    const [fmt, raw, logResult] = await Promise.all([
      sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges }),
      sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges, valueRenderOption: "UNFORMATTED_VALUE" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "ImportLog!A:F" }).catch(() => ({ data: { values: [] } }))
    ]);
    const F = index => (fmt.data.valueRanges[index].values || []).slice(1);
    const R = index => (raw.data.valueRanges[index].values || []).slice(1);
    const purchaseDates = new Map();
    (logResult.data.values || []).slice(1).forEach(row => {
      if (row[1] === "ticketmaster" && row[2] && row[3] && !purchaseDates.has(String(row[2]))) {
        purchaseDates.set(String(row[2]), row[3]);
      }
    });
    const allOrders = pairedRows(F(0), R(0)).filter(({ row }) => String(row[8] || "").trim()).map(({ row, raw: rawRow }) => ({
      event: row[0] || "", venue: row[2] || "", date: rawRow[1], qty: row[6], cost: parseMoney(row[7]),
      orderId: String(row[8]), purchaseDate: rawRow[11] || purchaseDates.get(String(row[8])) || "",
      dayKey: dayKey(rawRow[1]), tokens: tokens(row[0])
    }));
    const orders = allOrders.filter(order => isTrackedPurchase(order.purchaseDate));
    const salesFor = index => pairedRows(F(index), R(index))
      .filter(({ row }) => String(row[3] || "").trim() && String(row[8] || "").trim() !== "Cancelled")
      .map(({ row, raw: rawRow }) => ({
        event: row[0] || "", date: rawRow[2], qty: row[6], payout: parseMoney(row[7]),
        dayKey: dayKey(rawRow[2]), tokens: tokens(row[0])
      }));
    const summaries = summarise(buildGroups(allOrders, salesFor(1).concat(salesFor(2))));
    const months = buildMonthly(orders, summaries);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(render(months));
  } catch (error) {
    console.error("Monthly page error", error);
    return res.status(500).send("Monthly performance could not be loaded.");
  }
};

module.exports._test = { render };
