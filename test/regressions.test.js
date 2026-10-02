const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeSheets } = require('../test-support/fake-sheets');
const { withSheetLock, LOCK_TITLE } = require('../lib/sheet-lock');
const { syncFastmail, upsertOrders, upsertSales, writeUpsert, mergeRecords, applyPayments, backfillSaleCurrencies } = require('../lib/importer');
const { purchaseTimestamp } = require('../lib/purchase-date');
const { sheetMoney, saleValues, parseMoney, dayKey } = require('../lib/utils');
const { buildGroups, summarise, tokens } = require('../lib/finance');
const { buildMonthly } = require('../lib/monthly');
const { normaliseProfit, render: renderViagogo } = require('../api/viagogo')._test;
const { tabStats } = require('../api/dashboard')._test;

function baseTables() {
  return {
    Orders: [['Event','Date','Venue','Section','Row','Seats','Quantity','Cost','Order ID','Account','Status','Purchase date','Currency']],
    Sheet1: [['Event','Venue','Date','Order ID','Section','Row','Quantity','Payout','Profit','Currency']],
    Viagogo: [['Event','Venue','Date','Order ID','Section','Row','Quantity','Payout','Paid','Profit','Currency']],
    ImportLog: [['Fastmail Message ID','Type','External ID','Received','Imported','Status']]
  };
}
const purchaseEmail = {
  id: 'm1', from: 'orders@ticketmaster.co.uk', subject: 'Your ticket confirmation', to: 'orders@example.com',
  receivedAt: '2026-09-01T12:00:00Z', sentAt: '2026-09-01T11:00:00Z',
  body: 'ORDER # 18-34731/UK5 SCHOOLBOY Q The O2 Sunday 13 September 2026 18:30 Ticket Quantity: 2 SECTION: 101 ROW: A SEATS: 5 - 6 Ticket(s): £75.00 x 2 Total (incl. fee): £170.00'
};

function financeOrder(currency = '£', qty = '2') {
  const date = '20/10/2026';
  return { event: 'Artist', qty, date, dayKey: dayKey(date), tokens: tokens('Artist'), cost: { cur: currency, amt: 200 }, purchaseDate: '2026-09-01T10:00:00Z' };
}
function financeSale(profit, qty = '2', currency = '£') {
  const date = '20/10/2026';
  return { event: 'Artist', qty, date, dayKey: dayKey(date), tokens: tokens('Artist'), payout: { cur: currency, amt: 300 }, profit };
}

test('P&L uses supplied profit and never calculates missing Viagogo profit', () => {
  const order = financeOrder();
  const [known] = summarise(buildGroups([order], [financeSale({ cur: '£', amt: 7 })]));
  assert.equal(known.profitVal, 7);
  const [unknown] = summarise(buildGroups([order], [financeSale(null)]));
  assert.equal(unknown.profitVal, null);
  assert.match(unknown.issue, /Missing supplied/);
});

test('profit remains separated by currency on P&L', () => {
  const orders = [financeOrder('£'), financeOrder('$')];
  const [summary] = summarise(buildGroups(orders, [financeSale({ cur: '£', amt: 10 }), financeSale({ cur: '$', amt: 20 }, '2', '$')]));
  assert.equal(summary.profitVal, null);
  assert.equal(summary.profitStr, '£10.00  $20.00');
  assert.deepEqual(summary.profitAmounts, [{ cur: '£', amt: 10 }, { cur: '$', amt: 20 }]);
});

test('monthly excludes oversold, ambiguous, and invalid groups', () => {
  const order = financeOrder();
  for (const issue of ['Sold quantity exceeds purchased quantity', 'Ambiguous event match', 'Invalid purchase quantity']) {
    const [month] = buildMonthly([order], [{ orders: [order], sales: [financeSale({ cur: '£', amt: 7 })], issue }]);
    assert.equal(month.profitByCurrency['£'], 0);
    assert.equal(month.reviewEvents, 1);
  }
});

test('monthly cannot assign dollar profit to pound purchases', () => {
  const order = financeOrder();
  const [month] = buildMonthly([order], [{ orders: [order], sales: [financeSale({ cur: '$', amt: 7 }, '2', '$')], issue: 'Mixed currencies' }]);
  assert.deepEqual(month.profitByCurrency, { '£': 0, '$': 0, '€': 0 });
});

test('monthly checks overselling within each currency', () => {
  const orders = [financeOrder('£', '4'), financeOrder('$', '1')];
  const [month] = buildMonthly(orders, [{ orders, sales: [financeSale({ cur: '$', amt: 7 }, '2', '$')], issue: 'Mixed currencies' }]);
  assert.equal(month.profitByCurrency['$'], 0);
});

test('zero supplied profit is valid and mismatched profit currency is withheld', () => {
  const order = financeOrder();
  const [zero] = summarise(buildGroups([order], [financeSale({ cur: '£', amt: 0 })]));
  assert.equal(zero.profitVal, 0);
  assert.equal(zero.issue, '');
  const [wrong] = summarise(buildGroups([order], [financeSale({ cur: '$', amt: 50 })]));
  assert.equal(wrong.profitVal, null);
  assert.match(wrong.issue, /currency/);
});

test('currency parsing rejects unlabelled legacy numbers and ignores display formatting', () => {
  assert.equal(sheetMoney('£200', 200), null);
  assert.deepEqual(sheetMoney('£200', 200, '$'), { cur: '$', amt: 200 });
  assert.deepEqual(sheetMoney('£200.00', '$200'), { cur: '$', amt: 200 });
});

test('explicit manual profit currency is not relabelled by payout currency', () => {
  const row = ['Artist','','','1','','','2','£300','No','$50','£'];
  assert.deepEqual(saleValues(row).profit, { cur: '$', amt: 50 });
});

test('dashboard uses the same currency handling for totals and excludes cancelled sales', () => {
  const rows = [['Header'], ['Artist','','','1','','','2',300,'No',50,'$'], ['Cancelled','','','2','','','2','£300','Cancelled','£50','£']];
  const stats = tabStats(rows, { profitColumn: 9, paidColumn: 8, currencyColumn: 10 });
  assert.equal(stats.count, 1);
  assert.equal(stats.payout, '$300.00');
  assert.equal(stats.profit, '$50.00');
});

test('Viagogo entered totals exclude cancelled profits without deleting their rows', () => {
  const html = renderViagogo([{ event:'Cancelled Artist', date:'', order:'1', qty:'2', payout:'£300', paid:'Cancelled', profit:'£50' }], 'token');
  assert.ok(html.includes('Cancelled Artist'));
  assert.ok(!html.includes('£50.00'));
});

test('unlabelled manual profit requires a known payout currency', () => {
  assert.equal(normaliseProfit('50', ''), null);
  assert.equal(normaliseProfit('$50', ''), '$50.00');
});

test('newest notification wins while original purchase date remains earliest', () => {
  const messages = [
    { email: { receivedAt: '2026-10-02T10:00:00Z' }, record: { order_id: '1', payout: '£200', purchased_at: '2026-10-02T10:00:00Z' } },
    { email: { receivedAt: '2026-10-01T10:00:00Z' }, record: { order_id: '1', payout: '£100', venue: 'Arena', purchased_at: '2026-10-01T10:00:00Z' } }
  ];
  for (const input of [messages, [...messages].reverse()]) {
    assert.deepEqual(mergeRecords(input), [{ order_id: '1', payout: '£200', venue: 'Arena', purchased_at: '2026-10-01T10:00:00Z' }]);
  }
});

test('partial and repeated orders preserve confirmed quantity and manually corrected details', async () => {
  const input = baseTables();
  const original = ['Corrected Artist','20/10/2026','Corrected Venue','101','A','1-4','4','$220','1','account','Confirmed','2026-09-01T10:00:00Z','$'];
  input.Orders.push(original);
  const fake = fakeSheets(input);
  await upsertOrders(fake.sheets, 'sheet', [{ record: { order_id: '1', event: 'Old Artist', qty: '2', cost: '£170', purchased_at: '2026-10-01T10:00:00Z', order_currency: '£' } }]);
  assert.deepEqual(fake.tables.Orders[1], original);
  assert.equal(fake.calls.filter(([type]) => type === 'batchUpdate').length, 0);
});

test('sales imports preserve manual profit and payment statuses, including zero amounts', async () => {
  for (const status of ['Yes', 'Cancelled']) {
    const input = baseTables();
    const original = ['Artist','Arena','20/10/2026','1','','','2','£300',status,'£0.00','£'];
    input.Viagogo.push(original);
    const fake = fakeSheets(input);
    await upsertSales(fake.sheets, 'sheet', 'Viagogo', [{ record: { order_id:'1', payout:'£250', qty:'1' } }], false);
    assert.deepEqual(fake.tables.Viagogo[1], original);
    assert.equal(fake.calls.filter(([type]) => type === 'batchUpdate').length, 0);
  }
});

test('upserts batch only changed cells and never replace populated cells', async () => {
  const input = baseTables();
  input.Orders.push(['Artist','','','','','','2','£200','1']);
  const fake = fakeSheets(input);
  const result = await upsertOrders(fake.sheets, 'sheet', [{ record: { order_id:'1', venue:'Arena', qty:'4', order_currency:'£' } }]);
  assert.equal(result.updated, 1);
  assert.equal(fake.tables.Orders[1][6], '2');
  const ranges = fake.calls.find(([type]) => type === 'batchUpdate')[1].requestBody.data.map(item => item.range);
  assert.deepEqual(ranges, ['Orders!C2', 'Orders!M2']);
});

test('duplicate records within a batch append once and cannot update an unappended row', async () => {
  const fake = fakeSheets(baseTables());
  await writeUpsert(fake.sheets,'sheet','Viagogo',3,9,[{order_id:'1',event:'Artist'},{order_id:'1',event:'Latest'}], r=>[r.event,'','','1','','','','','No']);
  assert.equal(fake.tables.Viagogo.length, 2);
  assert.equal(fake.tables.Viagogo[1][0], 'Latest');
  assert.equal(fake.calls.filter(([type])=>type==='batchUpdate').length, 0);
});

test('existing duplicate IDs stop imports without changing financial rows', async () => {
  const input = baseTables();
  input.Orders.push(['','','','','','','','','1'], ['','','','','','','','','1']);
  const fake = fakeSheets(input);
  await assert.rejects(syncFastmail({sheets:fake.sheets,spreadsheetId:'sheet',fetchEmails:async()=>[purchaseEmail]}), /Duplicate order IDs/);
  assert.deepEqual(fake.tables.Orders, input.Orders);
  assert.equal(fake.tables[LOCK_TITLE], undefined);
});

test('distributed lock rejects competing writers and releases after success or error', async () => {
  const fake = fakeSheets(baseTables());
  let release;
  const gate = new Promise(resolve => { release=resolve; });
  let entered;
  const started = new Promise(resolve => { entered=resolve; });
  const first = withSheetLock(fake.sheets,'sheet',async()=>{ entered(); await gate; return 42; });
  await started;
  let secondRan = false;
  await assert.rejects(withSheetLock(fake.sheets,'sheet',async()=>{secondRan=true;}), error=>error.statusCode===409);
  assert.equal(secondRan,false);
  release(); assert.equal(await first,42);
  assert.equal(fake.tables[LOCK_TITLE],undefined);
  await assert.rejects(withSheetLock(fake.sheets,'sheet',async()=>{throw new Error('write failed');}), /write failed/);
  assert.equal(fake.tables[LOCK_TITLE],undefined);
});

test('direct purchases use original send time; forwarded purchases use original dated header', () => {
  assert.equal(purchaseTimestamp(purchaseEmail), '2026-09-01T11:00:00.000Z');
  assert.equal(purchaseTimestamp({...purchaseEmail,from:'forwarder@example.com',subject:'Fwd: Order',body:'Date: Mon, 31 Aug 2026 23:30:00 +0100\n' + purchaseEmail.body}), '2026-08-31T22:30:00.000Z');
  assert.equal(purchaseTimestamp({...purchaseEmail,from:'forwarder@example.com',subject:'Fwd: Order'}), '');
  assert.equal(purchaseTimestamp({...purchaseEmail,body:'Order date: 01/09/2026\n' + purchaseEmail.body}), '2026-09-01T00:00:00.000Z');
});

test('repeated complete sync does not duplicate orders, change confirmed quantity, or rewrite logs', async () => {
  const fake = fakeSheets(baseTables());
  const options = {sheets:fake.sheets,spreadsheetId:'sheet',fetchEmails:async()=>[purchaseEmail]};
  await syncFastmail(options);
  fake.tables.Orders[1][6] = '4';
  fake.tables.Orders[1][10] = 'Confirmed';
  const log = structuredClone(fake.tables.ImportLog);
  const before = fake.calls.length;
  const second = await syncFastmail(options);
  assert.equal(fake.tables.Orders.length,2);
  assert.equal(fake.tables.Orders[1][6],'4');
  assert.deepEqual(fake.tables.ImportLog,log);
  assert.equal(second.orders.updated,0);
  assert.equal(fake.calls.slice(before).filter(([type])=>['update','batchUpdate','append'].includes(type)).length,0);
  assert.equal(fake.calls.slice(before).filter(([type])=>type==='batchGet').length,2);
  assert.equal(fake.tables[LOCK_TITLE],undefined);
});

test('concurrent manual/daily syncs produce a single purchase row', async () => {
  const fake = fakeSheets(baseTables());
  const options = {sheets:fake.sheets,spreadsheetId:'sheet',fetchEmails:async()=>[purchaseEmail]};
  const results = await Promise.allSettled([syncFastmail(options),syncFastmail(options)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.statusCode,409);
  assert.equal(fake.tables.Orders.length,2);
});

test('payment notices preserve terminal statuses and stop unnecessary review retries', async () => {
  const input = baseTables();
  input.Viagogo.push(['Artist','','','12345678','','','','','Cancelled']);
  const fake = fakeSheets(input);
  const matched = await applyPayments(fake.sheets,'sheet',[{email:{id:'payment1',subject:'Payment for 12345678',body:''}}]);
  assert.ok(matched.has('payment1'));
  assert.equal(fake.tables.Viagogo[1][8],'Cancelled');
  assert.equal(fake.calls.filter(([type])=>type==='batchUpdate').length,0);
});

test('completed sale currency backfill never changes its payout or manual profit', async () => {
  const input = baseTables();
  input.Viagogo.push(['Artist','Arena','20/10/2026','12345678','','','2',300,'Yes','£71']);
  const fake = fakeSheets(input);
  const count = await backfillSaleCurrencies(fake.sheets,'sheet',[{from:'orders@viagogo.com',subject:'You sold your tickets for Artist - Order #12345678',body:'Payment Total: $300',receivedAt:'2026-10-01T10:00:00Z'}],{lysted:fake.tables.Sheet1,viagogo:fake.tables.Viagogo});
  assert.equal(count,1);
  assert.equal(fake.tables.Viagogo[1][10],'$');
  assert.equal(fake.tables.Viagogo[1][7],300);
  assert.equal(fake.tables.Viagogo[1][9],'£71');
});

test('formula cells and an intentionally blank confirmed quantity survive imports', async () => {
  const input = baseTables();
  input.Orders.push(['Artist','','','','','','','=SUM(A1:A2)','1','','Confirmed']);
  const fake = fakeSheets(input);
  await upsertOrders(fake.sheets,'sheet',[{record:{order_id:'1',qty:'2',cost:'£200'}}]);
  assert.equal(fake.tables.Orders[1][6],'');
  assert.equal(fake.tables.Orders[1][7],'=SUM(A1:A2)');
});

test('existing user columns are never overwritten by reserved currency headers', async () => {
  const input=baseTables(); input.Viagogo[0][10]='My notes';
  const fake=fakeSheets(input);
  await assert.rejects(syncFastmail({sheets:fake.sheets,spreadsheetId:'sheet',fetchEmails:async()=>[]}), /header conflict/);
  assert.equal(fake.tables.Viagogo[0][10],'My notes');
  assert.equal(fake.tables[LOCK_TITLE],undefined);
});

test('forwarded purchases without a reliable date remain reviewable without guessed month', async () => {
  const fake=fakeSheets(baseTables());
  const email={...purchaseEmail,from:'forwarder@example.com',subject:'Fwd: Your ticket confirmation'};
  const result=await syncFastmail({sheets:fake.sheets,spreadsheetId:'sheet',fetchEmails:async()=>[email]});
  assert.equal(fake.tables.Orders[1][11],'');
  assert.equal(fake.tables.ImportLog[1][5],'Review');
  assert.equal(result.review,1);
});

test('partial-scan warnings survive the manual and automatic import result', async () => {
  const fake=fakeSheets(baseTables());
  const emails=[]; emails.scanComplete=false; emails.warnings=['Scan incomplete'];
  const result=await syncFastmail({sheets:fake.sheets,spreadsheetId:'sheet',fetchEmails:async()=>emails});
  assert.equal(result.scanComplete,false);
  assert.deepEqual(result.warnings,['Scan incomplete']);
});

test('read-only audit reports duplicates and missing metadata without exposing business values', () => {
  const {auditTables}=require('../lib/sheet-audit');
  const input=baseTables();
  input.Orders.push(['Secret Artist','','','','','','2',100,'secret-order-id'],['Another Secret','','','','','','2',200,'secret-order-id']);
  const report=auditTables(input);
  assert.ok(report.Orders.issues.some(issue=>issue.issue==='Duplicate order ID' && issue.firstRow===2 && issue.row===3));
  assert.ok(report.Orders.issues.some(issue=>issue.issue==='Purchase date missing or invalid'));
  assert.ok(report.Orders.issues.some(issue=>issue.issue==='Cost or currency needs review'));
  assert.ok(!JSON.stringify(report).includes('Secret Artist'));
  assert.ok(!JSON.stringify(report).includes('secret-order-id'));
  assert.deepEqual(input.Orders[1],['Secret Artist','','','','','','2',100,'secret-order-id']);
});

test('currency backfills cannot relabel existing explicit currency or a corrected amount', async () => {
  for (const payout of ['$300', '£350']) {
    const input=baseTables(); input.Viagogo.push(['Artist','Arena','20/10/2026','12345678','','','2',payout,'No','£50']);
    const fake=fakeSheets(input);
    await upsertSales(fake.sheets,'sheet','Viagogo',[{record:{order_id:'12345678',payout:'£300'}}],false);
    assert.equal(fake.tables.Viagogo[1][10] || '', '');
    await backfillSaleCurrencies(fake.sheets,'sheet',[{from:'orders@viagogo.com',subject:'You sold your tickets for Artist - Order #12345678',body:'Payment Total: £300'}],{lysted:fake.tables.Sheet1,viagogo:fake.tables.Viagogo});
    assert.equal(fake.tables.Viagogo[1][10] || '', '');
    assert.equal(fake.tables.Viagogo[1][7],payout);
  }
});

test('lock remains held until every parallel sheet write settles after a failure', async () => {
  const fake=fakeSheets(baseTables());
  const append=fake.sheets.spreadsheets.values.append;
  let release, entered;
  const pending=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  fake.sheets.spreadsheets.values.append=async request=>{
    if (request.range.startsWith('Sheet1!')) throw new Error('Lysted write failed');
    if (request.range.startsWith('Orders!')) {entered();await pending;}
    return append(request);
  };
  const lysted={id:'sale1',from:'sales@lysted.com',subject:'TICKETS SOLD: Artist (Invoice #123456)',receivedAt:'2026-09-01T12:00:00Z',body:'Payout: $300 Profit: $7'};
  const running=syncFastmail({sheets:fake.sheets,spreadsheetId:'sheet',fetchEmails:async()=>[purchaseEmail,lysted]});
  const rejected=assert.rejects(running,/Lysted write failed/);
  await started;
  assert.notEqual(fake.tables[LOCK_TITLE],undefined);
  await assert.rejects(withSheetLock(fake.sheets,'sheet',async()=>{}),error=>error.statusCode===409);
  release(); await rejected;
  assert.equal(fake.tables[LOCK_TITLE],undefined);
});

test('Viagogo name repair uses newest reliable names across mail accounts and preserves money', async () => {
  const {repairViagogoNames}=require('../lib/importer');
  const input=baseTables();
  input.Viagogo.push(['<td>broken</td>','<td>broken</td>','20/10/2026','12345678','','','2','£300','Yes','£71','£']);
  const fake=fakeSheets(input);
  const message=(event,venue,receivedAt)=>({from:'orders@viagogo.com',subject:'Please transfer the tickets - 12345678',receivedAt,body:`Order ID: 12345678\nEvent: ${event}\nVenue: ${venue}`});
  await repairViagogoNames(fake.sheets,'sheet',[message('Older Artist','Old Arena','2026-10-01T10:00:00Z'),message('New Artist','New Arena','2026-10-02T10:00:00Z')]);
  assert.equal(fake.tables.Viagogo[1][0],'New Artist');
  assert.equal(fake.tables.Viagogo[1][1],'New Arena');
  assert.deepEqual(fake.tables.Viagogo[1].slice(7),['£300','Yes','£71','£']);
});

test('live-sheet preparation fills only blank currency metadata supported by stored symbols', () => {
  const {planCurrencyBackfill}=require('../lib/sheet-audit');
  const input=baseTables();
  input.Orders.push(['','','','','','','2','$100','1','','','2026-09-01T10:00:00Z','']);
  input.Viagogo.push(['Artist','','','1','','','2',100,'No','£7',''],['Artist','','','2','','','2','£200','Yes','£9','$'],['Artist','','','3','','','2','=SUM(A1:A2)','No','£9','']);
  assert.deepEqual(planCurrencyBackfill(input),[{range:'Orders!M2',values:[['$']]}]);
  assert.equal(input.Viagogo[2][10],'$');
});

test('sheet audit distinguishes missing profit from an existing profit with unknown currency', () => {
  const {auditTables}=require('../lib/sheet-audit');
  const input=baseTables();
  input.Viagogo.push(['Artist','','','1','','','2',100,'No',7,''],['Artist','','','2','','','2',100,'No','','']);
  const report=auditTables(input);
  assert.ok(report.Viagogo.issues.some(issue=>issue.row===2 && issue.issue==='Profit or currency needs review'));
  assert.ok(!report.Viagogo.issues.some(issue=>issue.row===2 && issue.issue==='Supplied or manual profit missing'));
  assert.ok(report.Viagogo.issues.some(issue=>issue.row===3 && issue.issue==='Supplied or manual profit missing'));
});
