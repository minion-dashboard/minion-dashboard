const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { fakeSheets } = require('../test-support/fake-sheets');
const sheetsModule = require('../lib/sheets');
const fastmailModule = require('../lib/fastmail');
let current;
sheetsModule.client = () => current.sheets;
sheetsModule.sheetId = () => 'memory-only';
fastmailModule.fetchRecentEmails = async () => [];
const dashboard = require('../api/dashboard');
const monthly = require('../api/monthly');
const pnl = require('../api/pnl');
const viagogo = require('../api/viagogo');
const sync = require('../api/sync');
const { csrfToken } = require('../lib/security');
const { LOCK_TITLE, withSheetLock } = require('../lib/sheet-lock');
const previousPassword = process.env.PASSWORD;
const previousCron = process.env.CRON_SECRET;
process.env.PASSWORD = 'handler-test-password';
process.env.CRON_SECRET = 'handler-test-cron-secret';
test.after(() => {
  if (previousPassword === undefined) delete process.env.PASSWORD; else process.env.PASSWORD = previousPassword;
  if (previousCron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previousCron;
});

function fixture() {
  return fakeSheets({
    Orders: [['Event','Date','Venue','Section','Row','Seats','Quantity','Cost','Order ID','Account','Status','Purchase date','Currency'],
      ['Artist','20/10/2026','Arena','','','','4',200,'purchase1','account','Check','2026-09-01T10:00:00Z','£'],
      ['Undated Artist','21/10/2026','Arena','','','','1','$20','undated','','Check','','$']],
    Sheet1: [['Event','Venue','Date','Order ID','Section','Row','Quantity','Payout','Profit','Currency'],
      ['Artist','Arena','20/10/2026','sale1','','','1',300,7,'£']],
    Viagogo: [['Event','Venue','Date','Order ID','Section','Row','Quantity','Payout','Paid','Profit','Currency'],
      ['Artist','Arena','20/10/2026','sale2','','','1',300,'No',3,'£'],
      ['Cancelled','Arena','21/10/2026','sale3','','','1',300,'Cancelled','£90','£']],
    ImportLog: [['Fastmail Message ID','Type','External ID','Received','Imported','Status']]
  });
}
function request(url, method='GET') {
  return {url,method,headers:{authorization:'Basic '+Buffer.from('user:handler-test-password').toString('base64'),'x-csrf-token':csrfToken()}};
}
function response() {
  return {statusCode:200,headers:{},body:null,headersSent:false,
    setHeader(key,value){this.headers[key]=value;},
    status(code){this.statusCode=code;return this;},
    send(body){this.body=body;this.headersSent=true;return this;},
    json(body){this.body=body;this.headersSent=true;return this;}};
}

test('authenticated pages render real handler HTML and valid browser scripts using one Sheets read', async () => {
  for (const [handler,url] of [[dashboard,'/'],[monthly,'/monthly'],[pnl,'/pnl'],[viagogo,'/viagogo']]) {
    current=fixture();
    const res=response(); await handler(request(url),res);
    assert.equal(res.statusCode,200,url);
    assert.match(res.body,/<!doctype html>/i);
    assert.equal(res.headers['X-Frame-Options'],'DENY');
    for (const match of res.body.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
    const readCalls=current.calls.filter(([type])=>['get','batchGet'].includes(type));
    assert.equal(readCalls.length,1,url);
    assert.equal(current.calls.filter(([type])=>['update','batchUpdate','append','structure'].includes(type)).length,0);
    if (handler===monthly || handler===pnl) assert.match(res.body,/£10\.00/);
    if (handler===monthly) assert.match(res.body,/Undated Artist/);
    if (handler===viagogo) assert.ok(!res.body.includes('£93.00'));
  }
});

test('quantity, currency, and purchase-date corrections persist and release shared write protection', async () => {
  current=fixture();
  for (const url of ['/monthly?confirm=purchase1&qty=6','/monthly?currency=purchase1&value=%24','/monthly?purchase=undated&value=02%2F09%2F2026']) {
    const res=response(); await monthly(request(url,'POST'),res);
    assert.equal(res.statusCode,200,url);
    assert.equal(current.tables[LOCK_TITLE],undefined);
  }
  assert.equal(current.tables.Orders[1][6],6);
  assert.equal(current.tables.Orders[1][10],'Confirmed');
  assert.equal(current.tables.Orders[1][12],'$');
  assert.equal(current.tables.Orders[2][11],'2026-09-02T00:00:00.000Z');
});

test('profit mutations use payout currency, allow explicit losses, and never calculate profit', async () => {
  current=fixture();
  let res=response(); await viagogo(request('/viagogo?profit=sale2&amount=12','POST'),res);
  assert.equal(res.statusCode,200); assert.equal(current.tables.Viagogo[1][9],'£12.00');
  res=response(); await viagogo(request('/viagogo?profit=sale2&amount=-%C2%A35','POST'),res);
  assert.equal(res.statusCode,200); assert.equal(current.tables.Viagogo[1][9],'-£5.00');
});

test('manual and cron imports share the protected importer and unauthorised cron cannot write', async () => {
  current=fixture();
  let res=response(); await sync({url:'/api/sync',method:'GET',headers:{}},res);
  assert.equal(res.statusCode,401); assert.equal(current.calls.length,0);
  res=response(); await sync({url:'/api/sync',method:'GET',headers:{authorization:'Bearer handler-test-cron-secret'}},res);
  assert.equal(res.statusCode,200); assert.equal(res.body.scanComplete,true);
  res=response(); await sync(request('/api/sync','POST'),res);
  assert.equal(res.statusCode,200); assert.equal(current.tables[LOCK_TITLE],undefined);
});

test('dashboard mutations return 409 while an import holds the shared lock', async () => {
  current=fixture();
  await withSheetLock(current.sheets,'memory-only',async()=>{
    const res=response(); await monthly(request('/monthly?confirm=purchase1&qty=6','POST'),res);
    assert.equal(res.statusCode,409);
    assert.equal(current.tables.Orders[1][6],'4');
  });
});
