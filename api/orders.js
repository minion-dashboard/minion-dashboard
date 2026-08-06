const { google } = require("googleapis");
const MAIN_SHEET_ID = "1HCAL0ei_RrxpIdoPC_IY_qzhPTsukwaTGBnIf8lZJQo";
const ORDERS_TAB = "Orders";

function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}

function fmtDate(v){
  if(typeof v==="number"){const d=new Date(Date.UTC(1899,11,30)+v*86400000);const p=x=>(x<10?"0":"")+x;
    const hm=d.getUTCHours()||d.getUTCMinutes()?" "+p(d.getUTCHours())+":"+p(d.getUTCMinutes()):"";
    return p(d.getUTCDate())+"/"+p(d.getUTCMonth()+1)+"/"+d.getUTCFullYear()+hm;}
  return String(v||"");
}

module.exports = async (req, res) => {
  if (process.env.PASSWORD) {
    const auth = req.headers.authorization || "";
    const ok = auth.startsWith("Basic ") &&
      Buffer.from(auth.slice(6),"base64").toString().split(":").pop() === process.env.PASSWORD;
    if(!ok){res.setHeader("WWW-Authenticate",'Basic realm="Minion Tickets"');return res.status(401).send("Password required");}
  }
  try {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const jwt = new google.auth.JWT(creds.client_email,null,creds.private_key,
      ["https://www.googleapis.com/auth/spreadsheets"]);
    const sheets = google.sheets({version:"v4",auth:jwt});

    const reqUrl = new URL(req.url,"http://x");
    const confirmId = reqUrl.searchParams.get("confirm");
    const setQty = reqUrl.searchParams.get("qty");
    if (confirmId && req.method === "POST") {
      const col = await sheets.spreadsheets.values.get({spreadsheetId:MAIN_SHEET_ID,range:`${ORDERS_TAB}!I:I`});
      const rows = col.data.values||[];
      let n=-1; for(let i=1;i<rows.length;i++){if(String(rows[i][0]||"").trim()===String(confirmId).trim()){n=i+1;break;}}
      if(n===-1) return res.status(404).send("Order not found");
      const upd=[{range:`${ORDERS_TAB}!K${n}`,values:[["Confirmed"]]}];
      if(setQty) upd.push({range:`${ORDERS_TAB}!G${n}`,values:[[setQty]]});
      await sheets.spreadsheets.values.batchUpdate({spreadsheetId:MAIN_SHEET_ID,
        requestBody:{valueInputOption:"RAW",data:upd}});
      return res.status(200).send("OK");
    }

    const [fmt,raw] = await Promise.all([
      sheets.spreadsheets.values.get({spreadsheetId:MAIN_SHEET_ID,range:`${ORDERS_TAB}!A:K`}),
      sheets.spreadsheets.values.get({spreadsheetId:MAIN_SHEET_ID,range:`${ORDERS_TAB}!A:K`,valueRenderOption:"UNFORMATTED_VALUE"}),
    ]);
    const F=(fmt.data.values||[]).slice(1), R=(raw.data.values||[]).slice(1);
    const orders = F.filter(r=>(r[8]||"").toString().trim()).map((r,i)=>({
      event:r[0]||"",date:fmtDate((R[i]||r)[1]),venue:r[2]||"",section:r[3]||"",row:r[4]||"",
      seats:r[5]||"",qty:r[6]||"",cost:r[7]||"",order:r[8]||"",account:r[9]||"",status:r[10]||""}));
    const flagged = orders.filter(o=>o.status==="Check");
    const totalCost = (()=>{const t={};orders.forEach(o=>{const v=String(o.cost||"");if(!v)return;
      const c=(v.match(/[£$€]/)||["£"])[0];const n=parseFloat(v.replace(/[^0-9.]/g,""));if(!isNaN(n))t[c]=(t[c]||0)+n;});
      return Object.keys(t).map(c=>c+t[c].toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,",")).join("  ")||"-";})();

    const rowsHtml = orders.map(o=>{
      const flag=o.status==="Check";
      return `<tr class="${flag?'flag':''}"><td>${esc(o.event)}</td><td>${esc(o.date)}</td><td>${esc(o.venue)}</td>`+
        `<td>${esc(o.section)}${o.row?" / "+esc(o.row):""}${o.seats?" / "+esc(o.seats):""}</td>`+
        `<td>${esc(o.qty)}</td><td>${esc(o.cost)}</td><td>${esc(o.account)}</td>`+
        `<td>${flag?`<button class="btn" onclick="confirmOrder('${esc(o.order)}')">Confirm</button>`
              :(o.status==="Confirmed"?'<span class="ok">Confirmed</span>':'')}</td></tr>`;
    }).join("");

    const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Minion Tickets - Orders</title><style>
*{box-sizing:border-box}body{font-family:Segoe UI,Arial,sans-serif;margin:0;padding:22px;color:#eef0ff;background:#0a0a14;min-height:100vh;position:relative}
body::before{content:"";position:fixed;inset:0;z-index:-1;background:
radial-gradient(600px 500px at 12% 8%,rgba(139,124,247,.42),transparent 60%),
radial-gradient(700px 600px at 88% 20%,rgba(56,189,248,.30),transparent 60%),
radial-gradient(700px 700px at 45% 95%,rgba(217,70,239,.26),transparent 60%),#0a0a14}
.top{background:rgba(255,255,255,.07);backdrop-filter:blur(22px) saturate(160%);-webkit-backdrop-filter:blur(22px) saturate(160%);
border:1px solid rgba(255,255,255,.16);border-radius:20px;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;box-shadow:0 8px 32px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.18)}
h1{font-size:24px;margin:0;font-weight:800;letter-spacing:.5px;background:linear-gradient(90deg,#e6dcff,#a8b8ff);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:0 0 30px rgba(160,150,255,.35)}
a.nav{color:#cfd2f4;text-decoration:none;font-size:13px;border:1px solid rgba(255,255,255,.22);padding:6px 14px;border-radius:999px;background:rgba(255,255,255,.06)}
.panel{background:rgba(255,255,255,.06);backdrop-filter:blur(22px) saturate(160%);-webkit-backdrop-filter:blur(22px) saturate(160%);border:1px solid rgba(255,255,255,.14);border-radius:20px;margin-bottom:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.14)}
.phead{padding:13px 20px;border-bottom:1px solid rgba(255,255,255,.10);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#c3c6ea}
.pbody{padding:6px 8px}
.cards{display:flex;flex-wrap:wrap;gap:12px;padding:14px}
.card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:14px 20px;min-width:150px;box-shadow:inset 0 1px 0 rgba(255,255,255,.16)}
.card .n{font-size:22px;font-weight:700;color:#dcd6ff;text-shadow:0 0 18px rgba(160,150,255,.45)}.card .l{font-size:11px;color:#a7abd6;margin-top:3px;letter-spacing:.08em;text-transform:uppercase}
table{width:100%;border-collapse:collapse}td,th{padding:9px 12px;font-size:13px;text-align:left;border-bottom:1px solid rgba(255,255,255,.09)}
th{color:#a7abd6;font-size:11px;letter-spacing:.1em;text-transform:uppercase}tr:last-child td{border-bottom:none}
tr.flag td{background:rgba(255,80,120,.12)}tr.flag td:first-child{box-shadow:inset 3px 0 0 #ff5a78}
.btn{background:rgba(255,255,255,.10);border:1px solid rgba(255,150,170,.45);color:#ffc9d6;border-radius:10px;padding:5px 12px;font-size:12px;cursor:pointer}
.btn:hover{background:rgba(255,120,150,.20)}.ok{color:#9be7b4;font-size:12px}
.foot{color:#8286b4;font-size:12px;margin-top:8px}
</style></head><body>
<div class="top"><h1>MINION TICKETS &mdash; ORDERS</h1><div><a class="nav" href="/">Sales</a><a class="nav" href="/pnl">P&amp;L</a><a class="nav" href="/costs">Costs</a></div></div>
<div class="panel"><div class="cards">
<div class="card"><div class="n">${orders.length}</div><div class="l">Orders</div></div>
<div class="card"><div class="n">${esc(totalCost)}</div><div class="l">Total spend</div></div>
<div class="card"><div class="n">${flagged.length}</div><div class="l">Need checking</div></div>
</div></div>
<div class="panel"><div class="phead">Ticket orders${flagged.length?` &middot; ${flagged.length} flagged red need quantity/cost confirmed`:""}</div>
<div class="pbody"><table>
<tr><th>Event</th><th>Date</th><th>Venue</th><th>Sec / Row / Seats</th><th>Qty</th><th>Cost</th><th>Account</th><th></th></tr>
${rowsHtml||'<tr><td colspan="8" style="padding:18px;color:#8286b4">No orders yet.</td></tr>'}
</table></div></div>
<div class="foot">Purchases from forwarded Ticketmaster confirmations &middot; refresh any time.</div>
<script>
function confirmOrder(id){
  var q=prompt("Confirm order "+id+".\\nEnter the correct ticket quantity (leave blank to keep as is):");
  if(q===null) return;
  var url="?confirm="+encodeURIComponent(id)+(q.trim()?"&qty="+encodeURIComponent(q.trim()):"");
  fetch(url,{method:"POST"}).then(function(r){return r.ok?location.reload():r.text().then(function(t){alert("Failed: "+t);});}).catch(function(e){alert("Failed: "+e);});
}
</script>
</body></html>`;
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.setHeader("Cache-Control","no-store");
    return res.status(200).send(html);
  } catch(e){
    return res.status(500).send("Orders page error: "+esc(e.message)+
      "<br><br>Check the Orders tab exists and the sheet is shared with the service account as Editor.");
  }
};
