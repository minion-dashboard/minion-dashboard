const { authenticate, csrfToken, requireMutation } = require("../lib/security");
const { client, sheetId } = require("../lib/sheets");
const { esc, fmtDate, money, pairedRows, parseMoney, sumByCur, toDate } = require("../lib/utils");

const COSTS_TAB = "Costs";
const RENEWAL_SOON_DAYS = 7;

const COLUMNS = ["Item","Category","Provider","Amount","Cycle","Start date","Status","Notes"];
const CYCLES  = ["Monthly","Annual","Quarterly","Weekly","One-off"];

// Convert any billing cycle to a monthly-equivalent figure
function monthlyEquivalent(m, cycle){
  if(!m) return null;
  switch(String(cycle||"").toLowerCase()){
    case "monthly":   return {cur:m.cur, amt:m.amt};
    case "annual":
    case "yearly":    return {cur:m.cur, amt:m.amt/12};
    case "quarterly": return {cur:m.cur, amt:m.amt/3};
    case "weekly":    return {cur:m.cur, amt:m.amt*52/12};
    default:          return null;               // one-off: not part of run rate
  }
}

// Next renewal date: roll the start date forward by the cycle until it's in the future
function addMonthsClamped(anchor, months) {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchor.getUTCDate(), lastDay)));
}

function nextRenewal(start, cycle, now = new Date()){
  const d = toDate(start);
  if(!d) return null;
  const c = String(cycle||"").toLowerCase();
  if(c==="one-off"||c==="") return null;
  const step = { monthly:{m:1}, yearly:{m:12}, annual:{m:12}, quarterly:{m:3}, weekly:{d:7} }[c];
  if(!step) return null;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let cur = new Date(d.getTime());
  let guard = 0;
  while (cur < today && guard++ < 600) {
    if (step.d) cur = new Date(cur.getTime() + step.d*86400000);
    else cur = addMonthsClamped(d, step.m * guard);
  }
  return cur;
}
function daysUntil(d){ return d ? Math.ceil((d - new Date())/86400000) : null; }

function card(n,l){return `<div class="card"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`;}

function render(items){
  const active = items.filter(i=>i.status.toLowerCase()!=="cancelled");
  const monthly = active.map(i=>i.monthly).filter(Boolean);
  const annualised = monthly.map(m=>({cur:m.cur,amt:m.amt*12}));
  const dueSoon = active.filter(i=>i.daysUntil!==null && i.daysUntil<=RENEWAL_SOON_DAYS && i.daysUntil>=0);
  const oneOffs = items.filter(i=>String(i.cycle).toLowerCase()==="one-off").map(i=>i.amount).filter(Boolean);

  // group by category
  const cats = {};
  active.forEach(i=>{ (cats[i.category||"Uncategorised"] = cats[i.category||"Uncategorised"] || []).push(i); });
  const catRows = Object.keys(cats).sort().map(c=>{
    const list = cats[c];
    const sub = sumByCur(list.map(i=>i.monthly).filter(Boolean));
    return `<tr class="cat"><td colspan="6">${esc(c)} &middot; ${list.length} item${list.length>1?"s":""} &middot; ${esc(sub)}/mo</td></tr>` +
      list.map(i=>{
        const soon = i.daysUntil!==null && i.daysUntil<=RENEWAL_SOON_DAYS && i.daysUntil>=0;
        return `<tr class="${soon?'warn':''}"><td>${esc(i.item)}</td><td>${esc(i.provider)}</td>
          <td>${esc(i.amountStr)}</td><td>${esc(i.cycle)}</td>
          <td>${esc(i.monthlyStr)}</td>
          <td class="${soon?'neg':''}">${esc(i.renewalStr)}${i.daysUntil!==null?` <span class="dim">(${i.daysUntil}d)</span>`:""}</td></tr>`;
      }).join("");
  }).join("");

  const cancelled = items.filter(i=>i.status.toLowerCase()==="cancelled");

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Minion Tickets - Running costs</title><style>
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
table{width:100%;border-collapse:collapse}td,th{padding:9px 12px;font-size:13px;text-align:left;border-bottom:1px solid rgba(255,255,255,.09)}
th{color:#a7abd6;font-size:11px;letter-spacing:.1em;text-transform:uppercase}tr:last-child td{border-bottom:none}
tr.cat td{background:rgba(255,255,255,.05);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#c3c6ea;font-weight:700}
tr.warn td{background:rgba(255,80,120,.10)}tr.warn td:first-child{box-shadow:inset 3px 0 0 #ff5a78}
.neg{color:#ff9dbb}.dim{color:#8286b4;font-size:11px}
form{display:flex;flex-wrap:wrap;gap:8px;padding:14px}
input,select{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);color:#eef0ff;
border-radius:10px;padding:8px 10px;font-size:13px;font-family:inherit;min-width:120px}
input::placeholder{color:#7f83ad}
button{background:rgba(139,124,247,.25);border:1px solid rgba(160,150,255,.5);color:#e6dcff;border-radius:10px;padding:8px 18px;font-size:13px;cursor:pointer}
button:hover{background:rgba(139,124,247,.4)}
.foot{color:#8286b4;font-size:12px;margin-top:8px}
</style></head><body>
<div class="top"><h1>RUNNING COSTS</h1><div>
<a class="nav" href="/">Sales</a><a class="nav" href="/orders">Orders</a><a class="nav" href="/monthly">Monthly</a><a class="nav" href="/pnl">P&amp;L</a></div></div>

<div class="panel"><div class="cards">
${card(sumByCur(monthly),"Per month")}${card(sumByCur(annualised),"Per year")}
${card(active.length,"Active items")}${card(dueSoon.length,"Renewing within "+RENEWAL_SOON_DAYS+"d")}
${card(sumByCur(oneOffs),"One-off spend")}
</div></div>

<div class="panel"><div class="phead">Add a cost</div>
<form onsubmit="return addCost(event)">
  <input name="item" placeholder="Item (e.g. Residential proxies)" required>
  <input name="category" placeholder="Category (e.g. Proxies)" list="cats">
  <datalist id="cats"><option>Proxies</option><option>Subscriptions</option><option>Software</option>
  <option>Hosting</option><option>Fees</option><option>Other</option></datalist>
  <input name="provider" placeholder="Provider">
  <input name="amount" placeholder="£0.00" required>
  <select name="cycle">${CYCLES.map(c=>`<option>${c}</option>`).join("")}</select>
  <input name="start" placeholder="Start dd/mm/yyyy">
  <input name="notes" placeholder="Notes">
  <button type="submit">Add</button>
</form></div>

<div class="panel"><div class="phead">Active costs${dueSoon.length?` &middot; ${dueSoon.length} renewing soon`:""}</div><div class="pbody">
<table><tr><th>Item</th><th>Provider</th><th>Amount</th><th>Cycle</th><th>Per month</th><th>Next renewal</th></tr>
${catRows||'<tr><td colspan="6" style="padding:18px;color:#8286b4">No costs recorded yet - add one above.</td></tr>'}
</table></div></div>

${cancelled.length?`<div class="panel"><div class="phead">Cancelled</div><div class="pbody"><table>
<tr><th>Item</th><th>Provider</th><th>Amount</th><th>Cycle</th></tr>
${cancelled.map(i=>`<tr><td>${esc(i.item)}</td><td>${esc(i.provider)}</td><td>${esc(i.amountStr)}</td><td>${esc(i.cycle)}</td></tr>`).join("")}
</table></div></div>`:""}

<div class="foot">Annual, quarterly and weekly costs are converted to a monthly equivalent for the run rate. One-off spend is listed separately. Mark an item Cancelled in the Costs tab to retire it.</div>
<script>
function addCost(e){
  e.preventDefault();
  var f=e.target, d={};
  ["item","category","provider","amount","cycle","start","notes"].forEach(function(k){ d[k]=f[k].value; });
  fetch("?add=1",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":"${csrfToken()}"},body:JSON.stringify(d)})
    .then(function(r){ return r.ok?location.reload():r.text().then(function(t){alert("Failed: "+t);}); })
    .catch(function(err){ alert("Failed: "+err); });
  return false;
}
</script>
</body></html>`;
}

module.exports = async (req,res) => {
  if (!authenticate(req, res)) return;
  try{
    const sheets=client("https://www.googleapis.com/auth/spreadsheets");
    const spreadsheetId=sheetId();

    // make sure the Costs tab exists
    const meta=await sheets.spreadsheets.get({spreadsheetId});
    if(!meta.data.sheets.some(s=>s.properties.title===COSTS_TAB)){
      await sheets.spreadsheets.batchUpdate({spreadsheetId,
        requestBody:{requests:[{addSheet:{properties:{title:COSTS_TAB}}}]}});
      await sheets.spreadsheets.values.update({spreadsheetId,
        range:`${COSTS_TAB}!A1:H1`,valueInputOption:"RAW",requestBody:{values:[COLUMNS]}});
    }

    if(req.method==="POST" && new URL(req.url,"http://x").searchParams.get("add")){
      if (!requireMutation(req, res)) return;
      let body=req.body;
      if(typeof body==="string") {
        if(body.length>10000) return res.status(413).send("Request is too large");
        body=JSON.parse(body||"{}");
      }
      const item=String(body&&body.item||"").trim();
      const category=String(body&&body.category||"").trim();
      const provider=String(body&&body.provider||"").trim();
      const cycle=String(body&&body.cycle||"Monthly").trim();
      const start=String(body&&body.start||"").trim();
      const notes=String(body&&body.notes||"").trim();
      const amount=parseMoney(body&&body.amount);
      if(!item||item.length>200) return res.status(400).send("Enter a valid item name");
      if(category.length>100||provider.length>100||notes.length>1000) return res.status(400).send("One or more fields are too long");
      if(!CYCLES.includes(cycle)) return res.status(400).send("Invalid billing cycle");
      if(!amount||amount.amt<=0||amount.amt>1000000000) return res.status(400).send("Enter a valid positive amount");
      if(start&&!toDate(start)) return res.status(400).send("Start date must be dd/mm/yyyy");
      const row=[item,category,provider,money(amount.cur,amount.amt),cycle,start,"Active",notes];
      await sheets.spreadsheets.values.append({spreadsheetId,range:`${COSTS_TAB}!A:H`,
        valueInputOption:"RAW",insertDataOption:"INSERT_ROWS",requestBody:{values:[row]}});
      return res.status(200).send("OK");
    }

    const [fmt,raw]=await Promise.all([
      sheets.spreadsheets.values.get({spreadsheetId,range:`${COSTS_TAB}!A:H`}),
      sheets.spreadsheets.values.get({spreadsheetId,range:`${COSTS_TAB}!A:H`,valueRenderOption:"UNFORMATTED_VALUE"}),
    ]);
    const F=(fmt.data.values||[]).slice(1), R=(raw.data.values||[]).slice(1);
    const items=pairedRows(F,R).filter(({row})=>(row[0]||"").toString().trim()).map(({row:r,raw:rr})=>{
      const amount=parseMoney(r[3]);
      const m=monthlyEquivalent(amount,r[4]);
      const nr=nextRenewal(rr[5],r[4]);
      return { item:r[0]||"", category:r[1]||"", provider:r[2]||"",
        amount, amountStr: amount?money(amount.cur,amount.amt):"-",
        cycle:r[4]||"", monthly:m, monthlyStr:m?money(m.cur,m.amt):"-",
        renewalStr: nr?fmtDate(nr):"-",
        daysUntil: daysUntil(nr), status:r[6]||"Active", notes:r[7]||"" };
    });

    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.setHeader("Cache-Control","no-store");
    return res.status(200).send(render(items));
  }catch(e){
    console.error("Costs page error", e);
    return res.status(500).send("Cost data could not be loaded.");
  }
};

module.exports._test = { addMonthsClamped, monthlyEquivalent, nextRenewal };
