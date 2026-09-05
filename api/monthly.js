const { buildGroups, summarise, tokens } = require("../lib/finance");
const { buildMonthly, isTrackedPurchase, monthKey } = require("../lib/monthly");
const { authenticate, csrfToken, requireMutation } = require("../lib/security");
const { client, sheetId } = require("../lib/sheets");
const { dayKey, esc, fmtDate, money, pairedRows, parseMoney, positiveInteger } = require("../lib/utils");

function card(value, label) {
  return `<div class="card"><div class="n">${esc(value)}</div><div class="l">${esc(label)}</div></div>`;
}

function amount(row, kind, currency) {
  const values = row[`${kind}ByCurrency`] || {};
  return money(currency, Number(values[currency]) || 0);
}

function amountCell(row, kind, currency) {
  const value = Number((row[`${kind}ByCurrency`] || {})[currency]) || 0;
  return `<td class="${kind === "profit" ? value < 0 ? "neg" : value > 0 ? "pos" : "" : ""}">${esc(money(currency, value))}</td>`;
}

function render(months, currentOrders, token, now = new Date()) {
  const currentKey = monthKey(now.toISOString());
  const current = months.find(month => month.key === currentKey) || {
    orders: 0, tickets: 0,
    spendByCurrency: { "£": 0, "$": 0, "€": 0 },
    profitByCurrency: { "£": 0, "$": 0, "€": 0 }
  };
  const rows = months.map(month => `<tr class="${month.key ? "" : "unknown"}">
    <td>${esc(month.label)}</td><td>${month.orders}</td><td>${month.tickets}</td>
    ${amountCell(month, "spend", "£")}${amountCell(month, "spend", "$")}${amountCell(month, "spend", "€")}
    ${amountCell(month, "profit", "£")}${amountCell(month, "profit", "$")}${amountCell(month, "profit", "€")}
    <td>${month.reviewEvents || "-"}</td></tr>`).join("");
  const orderRows = currentOrders.map(order => `<tr class="${order.currencyConfirmed ? "" : "flag"}">
    <td>${esc(order.purchaseDateText)}</td><td>${esc(order.event)}</td><td>${esc(order.eventDateText)}</td>
    <td>${esc(order.venue)}</td><td>${esc(order.qty)}</td><td>${esc(order.costText)}</td>
    <td><button class="btn currency-order" data-order="${esc(order.orderId)}" data-currency="${esc(order.currency || "")}">${esc(order.currencyConfirmed ? order.currency : "Set currency")}</button></td>
    <td>${esc(order.account)}</td><td>${order.status === "Check" ? `<button class="btn confirm-order" data-order="${esc(order.orderId)}">Confirm</button>` : order.status === "Confirmed" ? '<span class="ok">Confirmed</span>' : ""}</td></tr>`).join("");

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
table{width:100%;border-collapse:collapse;min-width:980px}td,th{padding:11px 12px;font-size:14px;text-align:left;border-bottom:1px solid rgba(255,255,255,.09)}th{color:#a7abd6;font-size:11px;letter-spacing:.1em;text-transform:uppercase}th.group{text-align:center;color:#d4d6f5;border-left:1px solid rgba(255,255,255,.09)}tr:last-child td{border-bottom:none}
.pos{color:#9be7b4}.neg{color:#ff9dbb}.unknown td{background:rgba(240,180,90,.08);color:#f3d39a}.flag td{background:rgba(240,180,90,.08)}.ok{color:#9be7b4}.btn{background:rgba(115,150,255,.14);border:1px solid rgba(150,175,255,.4);color:#dbe3ff;border-radius:10px;padding:6px 11px;font-size:12px;cursor:pointer}.btn:hover{background:rgba(115,150,255,.25)}.foot{color:#9296bf;font-size:12px;line-height:1.5;margin-top:8px}
@media(max-width:700px){body{padding:12px}.top{padding:16px}.card{min-width:calc(50% - 6px);padding:12px}.card .n{font-size:19px}}
</style></head><body>
<div class="top"><h1>MONTHLY PERFORMANCE</h1><div><a class="nav" href="/">Sales</a><a class="nav" href="/pnl">P&amp;L</a><a class="nav" href="/costs">Costs</a></div></div>
<div class="panel"><div class="phead">This month</div><div class="cards">${card(current.orders,"Orders placed")}${card(current.tickets,"Tickets bought")}${card(amount(current,"spend","£"),"UK spend")}${card(amount(current,"spend","$"),"US spend")}${card(amount(current,"spend","€"),"Euro spend")}${card(amount(current,"profit","£"),"UK profit")}${card(amount(current,"profit","$"),"US profit")}${card(amount(current,"profit","€"),"Euro profit")}</div></div>
<div class="panel"><div class="phead">Orders placed this month &middot; ${currentOrders.length}</div><div class="pbody"><table><thead><tr><th>Purchased</th><th>Event</th><th>Event date</th><th>Venue</th><th>Qty</th><th>Cost</th><th>Currency</th><th>Account</th><th></th></tr></thead><tbody>${orderRows || '<tr><td colspan="9" style="padding:18px;color:#8286b4">No orders have been imported this month.</td></tr>'}</tbody></table></div></div>
<div class="panel"><div class="phead">Performance by purchase month &middot; September 2026 onward</div><div class="pbody"><table><thead><tr><th rowspan="2">Purchase month</th><th rowspan="2">Orders</th><th rowspan="2">Tickets</th><th class="group" colspan="3">Purchase spend</th><th class="group" colspan="3">Realised profit</th><th rowspan="2">Events to review</th></tr><tr><th>GBP (£)</th><th>USD ($)</th><th>EUR (€)</th><th>GBP (£)</th><th>USD ($)</th><th>EUR (€)</th></tr></thead><tbody>${rows || '<tr><td colspan="10" style="padding:18px;color:#8286b4">No purchases have been tracked since September 2026.</td></tr>'}</tbody></table></div></div>
<div class="foot">Tracking starts on 1 September 2026. Order currency comes from the Ticketmaster confirmation and is stored separately from Google Sheets formatting. Amber rows have no confirmed currency yet; use Set currency to correct them.</div>
<script>
document.querySelectorAll(".confirm-order").forEach(function(button){button.addEventListener("click",function(){var quantity=prompt("Confirm order "+button.dataset.order+". Enter the correct ticket quantity, or leave blank to keep it:");if(quantity===null)return;var url="?confirm="+encodeURIComponent(button.dataset.order)+(quantity.trim()?"&qty="+encodeURIComponent(quantity.trim()):"");mutate(url);});});
document.querySelectorAll(".currency-order").forEach(function(button){button.addEventListener("click",function(){var value=prompt("Currency for order "+button.dataset.order+". Enter £, $ or €:",button.dataset.currency);if(value===null)return;mutate("?currency="+encodeURIComponent(button.dataset.order)+"&value="+encodeURIComponent(value.trim()));});});
function mutate(url){fetch(url,{method:"POST",headers:{"X-CSRF-Token":"${token}"}}).then(function(response){return response.ok?location.reload():response.text().then(function(text){throw new Error(text);});}).catch(function(error){alert("Failed: "+error.message);});}
</script>
</body></html>`;
}

module.exports = async (req, res) => {
  if (!authenticate(req, res)) return;
  try {
    const sheets = client("https://www.googleapis.com/auth/spreadsheets");
    const spreadsheetId = sheetId();
    const requestUrl = new URL(req.url, "http://x");
    const confirmId = requestUrl.searchParams.get("confirm");
    const currencyId = requestUrl.searchParams.get("currency");
    if ((confirmId !== null || currencyId !== null) && req.method === "POST") {
      if (!requireMutation(req, res)) return;
      const orderId = String(confirmId !== null ? confirmId : currencyId).trim();
      if (!orderId || orderId.length > 200) return res.status(400).send("Invalid order ID");
      const ids = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Orders!I:I" });
      const index = (ids.data.values || []).findIndex((row, rowIndex) => rowIndex > 0 && String(row[0] || "").trim() === orderId);
      if (index < 0) return res.status(404).send("Order not found");
      if (currencyId !== null) {
        const currency = String(requestUrl.searchParams.get("value") || "").trim();
        if (!["£", "$", "€"].includes(currency)) return res.status(400).send("Currency must be £, $ or €");
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `Orders!M${index + 1}`,
          valueInputOption: "RAW", requestBody: { values: [[currency]] } });
      } else {
        const quantityText = requestUrl.searchParams.get("qty");
        const quantity = quantityText ? positiveInteger(quantityText) : null;
        if (quantityText && quantity === null) return res.status(400).send("Quantity must be a positive whole number");
        const updates = [{ range: `Orders!K${index + 1}`, values: [["Confirmed"]] }];
        if (quantity !== null) updates.push({ range: `Orders!G${index + 1}`, values: [[quantity]] });
        await sheets.spreadsheets.values.batchUpdate({ spreadsheetId,
          requestBody: { valueInputOption: "RAW", data: updates } });
      }
      return res.status(200).send("OK");
    }
    const ranges = ["Orders!A:M", "Sheet1!A:I", "Viagogo!A:J"];
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
    const allOrders = pairedRows(F(0), R(0)).filter(({ row }) => String(row[8] || "").trim()).map(({ row, raw: rawRow }) => {
      const purchaseDate = rawRow[11] || purchaseDates.get(String(row[8])) || "";
      const storedCurrency = ["£", "$", "€"].includes(String(row[12] || "").trim()) ? String(row[12]).trim() : "";
      const parsedCost = parseMoney(row[7]);
      const cost = parsedCost ? { cur: storedCurrency || parsedCost.cur, amt: parsedCost.amt } : null;
      return {
        event: row[0] || "", venue: row[2] || "", date: rawRow[1], eventDateText: fmtDate(rawRow[1]),
        section: row[3] || "", row: row[4] || "", seats: row[5] || "", qty: row[6], cost,
        costText: cost ? money(cost.cur, cost.amt) : String(row[7] || ""), orderId: String(row[8]),
        account: row[9] || "", status: row[10] || "", purchaseDate,
        purchaseDateText: fmtDate(purchaseDate), currency: storedCurrency || (parsedCost ? parsedCost.cur : ""),
        currencyConfirmed: Boolean(storedCurrency), dayKey: dayKey(rawRow[1]), tokens: tokens(row[0])
      };
    });
    const orders = allOrders.filter(order => isTrackedPurchase(order.purchaseDate));
    const currentKey = monthKey(new Date().toISOString());
    const currentOrders = orders.filter(order => monthKey(order.purchaseDate) === currentKey)
      .sort((left, right) => String(right.purchaseDate).localeCompare(String(left.purchaseDate)));
    const salesFor = (index, profitColumn) => pairedRows(F(index), R(index))
      .filter(({ row }) => String(row[3] || "").trim() && String(row[8] || "").trim() !== "Cancelled")
      .map(({ row, raw: rawRow }) => ({
        event: row[0] || "", date: rawRow[2], qty: row[6], payout: parseMoney(row[7]), profit: parseMoney(row[profitColumn]),
        dayKey: dayKey(rawRow[2]), tokens: tokens(row[0])
      }));
    const summaries = summarise(buildGroups(allOrders, salesFor(1, 8).concat(salesFor(2, 9))));
    const months = buildMonthly(orders, summaries);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(render(months, currentOrders, csrfToken()));
  } catch (error) {
    console.error("Monthly page error", error);
    return res.status(500).send("Monthly performance could not be loaded.");
  }
};

module.exports._test = { render };
