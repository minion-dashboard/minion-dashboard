const { buildGroups, summarise, tokens } = require("../lib/finance");
const { authenticate } = require("../lib/security");
const { client, sheetId } = require("../lib/sheets");
const { dayKey, esc, fmtDate, pairedRows, parseMoney, sumByCur } = require("../lib/utils");

const ORDERS_TAB = "Orders";
const LYSTED_TAB = "Sheet1";
const VIAGOGO_TAB = "Viagogo";
const SOON_DAYS = 21;   // "event approaching" warning window

// ---------- page ----------
function bar(sold, bought){
  const pct = bought > 0 ? Math.min(100, Math.round(sold/bought*100)) : 0;
  const col = pct === 0 ? "#ff5a78" : (pct < 100 ? "#f0b45a" : "#6ee7a8");
  return `<div class="bar"><span style="width:${pct}%;background:${col}"></span></div>`
       + `<div class="barlbl">${sold}/${bought} sold</div>`;
}
function card(n,l){ return `<div class="card"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`; }

function render(rows){
  const matched = rows.filter(r => r.sold > 0);
  const unsold  = rows.filter(r => r.unsoldQty > 0)
                      .sort((a,b) => (a.daysToEvent===null?9e9:a.daysToEvent) - (b.daysToEvent===null?9e9:b.daysToEvent));
  const soon = unsold.filter(r => r.daysToEvent !== null && r.daysToEvent >= 0 && r.daysToEvent <= SOON_DAYS);

  const totalProfit = sumByCur(rows.filter(r=>r.profitVal!==null).map(r=>({cur:r.profitCur,amt:r.profitVal})));
  const totalTied   = sumByCur(unsold.flatMap(r=>r.unsoldMoney));
  const ticketsHeld = unsold.reduce((n,r)=>n+r.unsoldQty,0);
  const winners = matched.filter(r=>r.profitVal>0).length;
  const losers  = matched.filter(r=>r.profitVal<0).length;

  const pnlRows = matched
    .sort((a,b)=>(b.profitVal||0)-(a.profitVal||0))
    .map(r=>`<tr><td>${esc(r.name)}${r.issue?`<div class="issue">Review: ${esc(r.issue)}</div>`:""}</td><td>${esc(fmtDate(r.date))}</td><td>${esc(r.costStr)}</td>
      <td>${esc(r.revStr)}</td><td class="${r.profitVal<0?'neg':'pos'}">${esc(r.profitStr)}</td>
      <td class="${r.roi<0?'neg':'pos'}">${r.roi===null?"-":r.roi.toFixed(1)+"%"}</td>
      <td style="min-width:120px">${bar(r.sold,r.bought)}</td></tr>`).join("");

  const invRows = unsold.map(r=>{
    const urgent = r.daysToEvent!==null && r.daysToEvent>=0 && r.daysToEvent<=SOON_DAYS;
    const past   = r.daysToEvent!==null && r.daysToEvent<0;
    const when = r.daysToEvent===null ? "-" : (past ? "event passed" : r.daysToEvent+" days");
    return `<tr class="${urgent?'warn':''}"><td>${esc(r.name)}</td><td>${esc(fmtDate(r.date))}</td>
      <td>${esc(r.venue||"")}</td><td>${r.unsoldQty}</td><td>${esc(r.unsoldCostStr)}</td>
      <td class="${urgent||past?'neg':''}">${esc(when)}</td>
      <td style="min-width:120px">${bar(r.sold,r.bought)}</td></tr>`;
  }).join("");

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Minion Tickets - P&amp;L</title><style>
*{box-sizing:border-box}body{font-family:Segoe UI,Arial,sans-serif;margin:0;padding:22px;color:#eef0ff;background:#0a0a14;min-height:100vh;position:relative}
body::before{content:"";position:fixed;inset:0;z-index:-1;background:
radial-gradient(600px 500px at 12% 8%,rgba(139,124,247,.42),transparent 60%),
radial-gradient(700px 600px at 88% 20%,rgba(56,189,248,.30),transparent 60%),
radial-gradient(700px 700px at 45% 95%,rgba(217,70,239,.26),transparent 60%),#0a0a14}
.top{background:rgba(255,255,255,.07);backdrop-filter:blur(22px) saturate(160%);-webkit-backdrop-filter:blur(22px) saturate(160%);
border:1px solid rgba(255,255,255,.16);border-radius:20px;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;
margin-bottom:18px;box-shadow:0 8px 32px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.18);gap:12px;flex-wrap:wrap}
h1{font-size:24px;margin:0;font-weight:800;letter-spacing:.5px;background:linear-gradient(90deg,#e6dcff,#a8b8ff);
-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:0 0 30px rgba(160,150,255,.35)}
a.nav{color:#cfd2f4;text-decoration:none;font-size:13px;border:1px solid rgba(255,255,255,.22);padding:6px 14px;border-radius:999px;background:rgba(255,255,255,.06);margin-left:8px}
.panel{background:rgba(255,255,255,.06);backdrop-filter:blur(22px) saturate(160%);-webkit-backdrop-filter:blur(22px) saturate(160%);
border:1px solid rgba(255,255,255,.14);border-radius:20px;margin-bottom:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.14)}
.phead{padding:13px 20px;border-bottom:1px solid rgba(255,255,255,.10);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#c3c6ea}
.pbody{padding:6px 8px}.cards{display:flex;flex-wrap:wrap;gap:12px;padding:14px}
.card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:14px 20px;min-width:150px;box-shadow:inset 0 1px 0 rgba(255,255,255,.16)}
.card .n{font-size:22px;font-weight:700;color:#dcd6ff;text-shadow:0 0 18px rgba(160,150,255,.45)}
.card .l{font-size:11px;color:#a7abd6;margin-top:3px;letter-spacing:.08em;text-transform:uppercase}
table{width:100%;border-collapse:collapse}td,th{padding:9px 12px;font-size:13px;text-align:left;border-bottom:1px solid rgba(255,255,255,.09);vertical-align:middle}
th{color:#a7abd6;font-size:11px;letter-spacing:.1em;text-transform:uppercase}tr:last-child td{border-bottom:none}
.pos{color:#9be7b4}.neg{color:#ff9dbb}
tr.warn td{background:rgba(255,80,120,.10)}tr.warn td:first-child{box-shadow:inset 3px 0 0 #ff5a78}
.bar{height:6px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden}
.bar span{display:block;height:100%;border-radius:99px}
.barlbl{font-size:10px;color:#a7abd6;margin-top:4px}
.issue{color:#ffb3c8;font-size:11px;margin-top:4px}
.foot{color:#8286b4;font-size:12px;margin-top:8px}
</style></head><body>
<div class="top"><h1>PROFIT &amp; INVENTORY</h1><div>
<a class="nav" href="/">Sales</a><a class="nav" href="/orders">Orders</a><a class="nav" href="/costs">Costs</a></div></div>

<div class="panel"><div class="cards">
${card(totalProfit,"Realised profit")}${card(ticketsHeld,"Tickets unsold")}${card(totalTied,"Cash tied up")}
${card(winners,"Events in profit")}${card(losers,"Events at a loss")}${card(soon.length,"Events soon, unsold")}
</div></div>

<div class="panel"><div class="phead">Unsold inventory${soon.length?` &middot; ${soon.length} with the event within ${SOON_DAYS} days`:""}</div><div class="pbody">
<table><tr><th>Event</th><th>Event date</th><th>Venue</th><th>Unsold</th><th>Cost tied up</th><th>Event in</th><th>Progress</th></tr>
${invRows||'<tr><td colspan="7" style="padding:18px;color:#8286b4">Nothing unsold - everything has sold.</td></tr>'}
</table></div></div>

<div class="panel"><div class="phead">Profit by event (matched purchases &amp; sales)</div><div class="pbody">
<table><tr><th>Event</th><th>Event date</th><th>Cost</th><th>Revenue</th><th>Profit</th><th>ROI</th><th>Progress</th></tr>
${pnlRows||'<tr><td colspan="7" style="padding:18px;color:#8286b4">No matched sales yet.</td></tr>'}
</table></div></div>

<div class="foot">Purchases matched to sales by event name &amp; date. Costs are apportioned per ticket, so partly-sold events show profit on the sold portion only. Profit is shown only where cost and revenue share a currency.</div>
</body></html>`;
}

// ---------- handler ----------
module.exports = async (req, res) => {
  if (!authenticate(req, res)) return;
  try {
    const sheets = client();
    const spreadsheetId = sheetId();
    const ranges = [`${ORDERS_TAB}!A:K`, `${LYSTED_TAB}!A:I`, `${VIAGOGO_TAB}!A:I`];
    const [fmt, raw] = await Promise.all([
      sheets.spreadsheets.values.batchGet({spreadsheetId, ranges}),
      sheets.spreadsheets.values.batchGet({spreadsheetId, ranges, valueRenderOption:"UNFORMATTED_VALUE"}),
    ]);
    const F = i => (fmt.data.valueRanges[i].values||[]).slice(1);
    const R = i => (raw.data.valueRanges[i].values||[]).slice(1);

    // Orders: Event A, Date B, Venue C, Qty G, Cost H, OrderID I
    const oF = F(0), oR = R(0);
    const orders = pairedRows(oF,oR).filter(({row})=>(row[8]||"").toString().trim()).map(({row:r,raw:rr})=>{
      return { event:r[0]||"", venue:r[2]||"", date:rr[1], qty:r[6], cost:parseMoney(r[7]),
               dayKey:dayKey(rr[1]), tokens:tokens(r[0]) };
    });

    // Sales: Event A, Date C, Qty G, Payout H  (both tabs share this shape)
    const mkSales = (idx) => {
      const sF = F(idx), sR = R(idx);
      return pairedRows(sF,sR).filter(({row})=>(row[3]||"").toString().trim() && String(row[8]||"").trim()!=="Cancelled").map(({row:r,raw:rr})=>{
        return { event:r[0]||"", date:rr[2], qty:r[6], payout:parseMoney(r[7]),
                 dayKey:dayKey(rr[2]), tokens:tokens(r[0]) };
      });
    };
    const sales = mkSales(1).concat(mkSales(2));

    const rows = summarise(buildGroups(orders, sales));
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.setHeader("Cache-Control","no-store");
    return res.status(200).send(render(rows));
  } catch(e){
    console.error("P&L page error", e);
    return res.status(500).send("P&amp;L data could not be loaded.");
  }
};
