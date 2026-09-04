const { authenticate, csrfToken, requireMutation } = require("../lib/security");
const { client, sheetId } = require("../lib/sheets");
const { esc, fmtDate, parseMoney, sumByCur, toDate } = require("../lib/utils");

const LYSTED_TAB = "Sheet1";
const VIAGOGO_TAB = "Viagogo";

function sumMoney(values) { return sumByCur(values.map(value => parseMoney(value, "$"))); }

function tabStats(rows, hasProfit, hasPaid) {
  const data = (rows || []).slice(1).filter((r) =>
    (r[3] || "").toString().trim() && (!hasPaid || String(r[8] || "").trim() !== "Cancelled"));
  const recent = data.slice(-8).reverse().map((r) => ({
    event: r[0] || "", date: fmtDate(r[2]), qty: r[6] || "", payout: r[7] || "",
    profit: hasProfit ? (r[8] || "") : null,
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

function collectOverdue(rawRows, fmtRows) {
  const now = new Date();
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - OVERDUE_DAYS));
  const out = [];
  (rawRows || []).slice(1).forEach((r, i) => {
    if (!(r[3] || "").toString().trim() || r[8] !== "No") return;
    const d = toDate(r[2]);
    if (!d || d >= cutoff) return;
    const f = (fmtRows || [])[i + 1] || r;  // formatted twin row for display
    out.push({ event: f[0] || "", date: fmtDate(f[2]), order: String(f[3] || ""), payout: f[7] || "" });
  });
  return out;
}

function card(n, label) {
  return `<div class="card"><div class="n">${esc(n)}</div><div class="l">${esc(label)}</div></div>`;
}

function table(recent) {
  const hasPaid = recent.some((r) => r.paid !== null && r.paid !== undefined);
  const hasProfit = recent.some((r) => r.profit !== null && r.profit !== undefined);
  const rows = recent.map((r) =>
    `<tr><td>${esc(r.event)}</td><td>${esc(r.date)}</td><td>${esc(r.qty)}</td><td>${esc(r.payout)}</td>` +
    (hasProfit ? `<td>${esc(r.profit || "")}</td>` : "") +
    (hasPaid ? `<td>${esc(r.paid || "")}</td>` : "") + `</tr>`
  ).join("");
  return `<table><tr><th>Event</th><th>Date</th><th>Qty</th><th>Payout</th>` +
    (hasProfit ? `<th>Profit</th>` : "") +
    (hasPaid ? `<th>Paid</th>` : "") + `</tr>${rows}</table>`;
}

function render(lysted, viagogo, overdue, token) {
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
.sync{border:1px solid rgba(130,210,255,.45);background:rgba(80,170,255,.13);cursor:pointer}
.sync:hover{background:rgba(80,170,255,.24)}
.sync:disabled{cursor:wait;opacity:.65}
.sync-status{font-size:11px;color:#a7abd6;margin-right:8px}
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
.btn{background:rgba(255,255,255,.10);border:1px solid rgba(255,150,170,.40);color:#ffc9d6;
border-radius:10px;padding:6px 12px;font-size:12px;cursor:pointer}
.btn:hover{background:rgba(255,120,150,.18)}
</style></head><body>
<div class="top"><h1>MINION TICKETS</h1><div><span class="sync-status" id="sync-status"></span><button class="badge sync" id="sync-inbox" type="button">Sync inbox</button> <a class="badge" href="/orders" style="text-decoration:none">Orders</a> <a class="badge" href="/pnl" style="text-decoration:none">P&amp;L</a> <a class="badge" href="/costs" style="text-decoration:none">Costs</a></div></div>
${overdue && overdue.length ? `<div class="alert"><div class="phead">&#9888; ${overdue.length} overdue payment${overdue.length > 1 ? "s" : ""} - unpaid ${OVERDUE_DAYS}+ days after the event</div><div class="pbody">
<table><tr><th>Event</th><th>Event date</th><th>Order</th><th>Amount</th><th></th></tr>
${overdue.map((o) => `<tr><td>${esc(o.event)}</td><td>${esc(o.date)}</td><td>${esc(o.order)}</td><td>${esc(o.payout)}</td><td><button class="btn cancel-order" data-order="${esc(o.order)}">Mark cancelled</button></td></tr>`).join("")}
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
<script>
document.querySelectorAll(".cancel-order").forEach(function(button){
 button.addEventListener("click", function(){ cancelOrder(button.dataset.order); });
});
document.getElementById("sync-inbox").addEventListener("click", function(){
  var button = this, status = document.getElementById("sync-status");
  button.disabled = true; status.textContent = "Syncing...";
  fetch("/api/sync", {method:"POST",headers:{"X-CSRF-Token":"${token}"}})
    .then(function(r){ return r.ok ? r.json() : r.text().then(function(t){ throw new Error(t); }); })
    .then(function(result){
      status.textContent = result.imported + " imported, " + result.review + " to review";
      setTimeout(function(){ location.reload(); }, 1200);
    })
    .catch(function(error){ status.textContent = "Sync failed"; alert("Failed: " + error.message); button.disabled = false; });
});
function cancelOrder(id){
  if(!confirm("Mark order " + id + " as cancelled? It will be removed from the overdue list and payment tracking.")) return;
  fetch("?cancel=" + encodeURIComponent(id), {method:"POST",headers:{"X-CSRF-Token":"${token}"}})
    .then(r => r.ok ? location.reload() : r.text().then(t => alert("Failed: " + t)))
    .catch(e => alert("Failed: " + e));
}
</script>
</body></html>`;
}

module.exports = async (req, res) => {
  if (!authenticate(req, res)) return;

  try {
    const sheets = client("https://www.googleapis.com/auth/spreadsheets");
    const spreadsheetId = sheetId();

    const reqUrl = new URL(req.url, "http://x");
    const cancelId = reqUrl.searchParams.get("cancel");
    if (cancelId && req.method === "POST") {
      if (!requireMutation(req, res)) return;
      if (cancelId.length > 200) return res.status(400).send("Invalid order ID");
      const col = await sheets.spreadsheets.values.get({
        spreadsheetId, range: `${VIAGOGO_TAB}!D:D`,
      });
      const rows = col.data.values || [];
      let rowNum = -1;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0] || "").trim() === String(cancelId).trim()) { rowNum = i + 1; break; }
      }
      if (rowNum === -1) return res.status(404).send("Order not found");
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: `${VIAGOGO_TAB}!I${rowNum}`,
        valueInputOption: "RAW", requestBody: { values: [["Cancelled"]] },
      });
      return res.status(200).send("OK");
    }

    const ranges = [`${LYSTED_TAB}!A:I`, `${VIAGOGO_TAB}!A:I`];
    const [fmt, raw] = await Promise.all([
      sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges }),
      sheets.spreadsheets.values.batchGet({
        spreadsheetId, ranges, valueRenderOption: "UNFORMATTED_VALUE",
      }),
    ]);
    const lysted = tabStats(fmt.data.valueRanges[0].values, true);
    const viagogo = tabStats(fmt.data.valueRanges[1].values, false, true);

    const overdue = collectOverdue(raw.data.valueRanges[1].values, fmt.data.valueRanges[1].values);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(render(lysted, viagogo, overdue, csrfToken()));
  } catch (e) {
    console.error("Dashboard error", e);
    return res.status(500).send("Dashboard data could not be loaded.");
  }
};
