const { authenticate, csrfToken, requireMutation } = require("../lib/security");
const { client, sheetId } = require("../lib/sheets");
const { esc, fmtDate, money, parseMoney, sumByCur } = require("../lib/utils");

const TAB = "Viagogo";

function normaliseProfit(value, defaultCurrency = "£") {
  const input = String(value == null ? "" : value).trim();
  if (!input) return "";
  if (input.length > 40) return null;
  const parsed = parseMoney(input, defaultCurrency);
  if (!parsed || Math.abs(parsed.amt) > 10000000) return null;
  return money(parsed.cur, parsed.amt);
}

function render(sales, token) {
  const entered = sales.filter(sale => sale.profit).length;
  const totalProfit = sumByCur(sales.map(sale => parseMoney(sale.profit)).filter(Boolean));
  const rows = sales.map(sale => `<tr><td>${esc(sale.event)}</td><td>${esc(sale.date)}</td><td>${esc(sale.order)}</td>
    <td>${esc(sale.qty)}</td><td>${esc(sale.payout)}</td><td>${esc(sale.paid)}</td>
    <td class="${sale.profit && (parseMoney(sale.profit) || {}).amt < 0 ? "neg" : "pos"}">${esc(sale.profit || "Not entered")}</td>
    <td><button class="btn edit-profit" data-order="${esc(sale.order)}" data-profit="${esc(sale.profit)}">${sale.profit ? "Edit" : "Add profit"}</button></td></tr>`).join("");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Minion Tickets - Viagogo Profits</title><style>
*{box-sizing:border-box}body{font-family:Segoe UI,Arial,sans-serif;margin:0;padding:22px;color:#eef0ff;background:#0a0a14;min-height:100vh;position:relative}body::before{content:"";position:fixed;inset:0;z-index:-1;background:radial-gradient(600px 500px at 12% 8%,rgba(139,124,247,.42),transparent 60%),radial-gradient(700px 600px at 88% 20%,rgba(56,189,248,.30),transparent 60%),radial-gradient(700px 700px at 45% 95%,rgba(217,70,239,.26),transparent 60%),#0a0a14}
.top{background:rgba(255,255,255,.07);backdrop-filter:blur(22px) saturate(160%);-webkit-backdrop-filter:blur(22px) saturate(160%);border:1px solid rgba(255,255,255,.16);border-radius:20px;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;box-shadow:0 8px 32px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.18);gap:12px;flex-wrap:wrap}
h1{font-size:24px;margin:0;font-weight:800;letter-spacing:.5px;background:linear-gradient(90deg,#e6dcff,#a8b8ff);-webkit-background-clip:text;background-clip:text;color:transparent}a.nav{color:#cfd2f4;text-decoration:none;font-size:13px;border:1px solid rgba(255,255,255,.22);padding:6px 14px;border-radius:999px;background:rgba(255,255,255,.06);margin-left:8px}
.panel{background:rgba(255,255,255,.06);backdrop-filter:blur(22px) saturate(160%);-webkit-backdrop-filter:blur(22px) saturate(160%);border:1px solid rgba(255,255,255,.14);border-radius:20px;margin-bottom:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.14)}.phead{padding:13px 20px;border-bottom:1px solid rgba(255,255,255,.10);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#c3c6ea}.pbody{padding:6px 8px;overflow-x:auto}
.cards{display:flex;flex-wrap:wrap;gap:12px;padding:14px}.card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:14px 20px;min-width:160px}.card .n{font-size:22px;font-weight:700;color:#dcd6ff}.card .l{font-size:11px;color:#a7abd6;margin-top:3px;letter-spacing:.08em;text-transform:uppercase}
table{width:100%;border-collapse:collapse;min-width:800px}td,th{padding:10px 12px;font-size:14px;text-align:left;border-bottom:1px solid rgba(255,255,255,.09)}th{color:#a7abd6;font-size:11px;letter-spacing:.1em;text-transform:uppercase}tr:last-child td{border-bottom:none}.pos{color:#9be7b4}.neg{color:#ff9dbb}
.btn{background:rgba(115,150,255,.14);border:1px solid rgba(150,175,255,.4);color:#dbe3ff;border-radius:10px;padding:6px 11px;font-size:12px;cursor:pointer}.btn:hover{background:rgba(115,150,255,.25)}.foot{color:#9296bf;font-size:12px;line-height:1.5;margin-top:8px}@media(max-width:700px){body{padding:12px}.top{padding:16px}}
</style></head><body>
<div class="top"><h1>VIAGOGO PROFITS</h1><div><a class="nav" href="/">Sales</a><a class="nav" href="/monthly">Monthly</a><a class="nav" href="/pnl">P&amp;L</a></div></div>
<div class="panel"><div class="cards"><div class="card"><div class="n">${sales.length}</div><div class="l">Viagogo sales</div></div><div class="card"><div class="n">${entered}</div><div class="l">Profits entered</div></div><div class="card"><div class="n">${esc(totalProfit)}</div><div class="l">Entered profit</div></div></div></div>
<div class="panel"><div class="phead">Sales and manual profit</div><div class="pbody"><table><tr><th>Event</th><th>Event date</th><th>Order</th><th>Qty</th><th>Payout</th><th>Paid</th><th>Profit</th><th></th></tr>${rows || '<tr><td colspan="8" style="padding:18px;color:#8286b4">No Viagogo sales yet.</td></tr>'}</table></div></div>
<div class="foot">Enter the final profit for each sale. A number without a symbol uses the same currency as that sale's payout. Enter a negative amount for a loss; submit a blank value to clear an entry.</div>
<script>document.querySelectorAll(".edit-profit").forEach(function(button){button.addEventListener("click",function(){var value=prompt("Profit for Viagogo order "+button.dataset.order+" (for example £120 or -£25):",button.dataset.profit);if(value===null)return;var url="?profit="+encodeURIComponent(button.dataset.order)+"&amount="+encodeURIComponent(value);fetch(url,{method:"POST",headers:{"X-CSRF-Token":"${token}"}}).then(function(r){return r.ok?location.reload():r.text().then(function(t){throw new Error(t);});}).catch(function(e){alert("Failed: "+e.message);});});});</script>
</body></html>`;
}

module.exports = async (req, res) => {
  if (!authenticate(req, res)) return;
  try {
    const sheets = client("https://www.googleapis.com/auth/spreadsheets");
    const spreadsheetId = sheetId();
    const url = new URL(req.url, "http://x");
    const orderId = url.searchParams.get("profit");
    if (orderId !== null) {
      if (!requireMutation(req, res)) return;
      if (!orderId || orderId.length > 200) return res.status(400).send("Invalid order ID");
      const saleRows = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${TAB}!A:J` });
      const rows = saleRows.data.values || [];
      const index = rows.findIndex((row, rowIndex) => rowIndex > 0 && String(row[3] || "").trim() === orderId.trim());
      if (index < 0) return res.status(404).send("Order not found");
      const payout = parseMoney(rows[index][7]);
      const profit = normaliseProfit(url.searchParams.get("amount"), payout ? payout.cur : "£");
      if (profit === null) return res.status(400).send("Enter a valid profit amount");
      await sheets.spreadsheets.values.update({ spreadsheetId, range: `${TAB}!J${index + 1}`,
        valueInputOption: "RAW", requestBody: { values: [[profit]] } });
      return res.status(200).send("OK");
    }
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${TAB}!A:J` });
    const sheetRows = response.data.values || [];
    if (!sheetRows[0] || sheetRows[0][9] !== "Profit") {
      await sheets.spreadsheets.values.update({ spreadsheetId, range: `${TAB}!J1`,
        valueInputOption: "RAW", requestBody: { values: [["Profit"]] } });
    }
    const sales = sheetRows.slice(1).filter(row => String(row[3] || "").trim()).map(row => ({
      event: row[0] || "", date: fmtDate(row[2]), order: String(row[3]), qty: row[6] || "",
      payout: row[7] || "", paid: row[8] || "", profit: row[9] || ""
    })).reverse();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(render(sales, csrfToken()));
  } catch (error) {
    console.error("Viagogo profits page error", error);
    return res.status(500).send("Viagogo sales could not be loaded.");
  }
};

module.exports._test = { normaliseProfit, render };
