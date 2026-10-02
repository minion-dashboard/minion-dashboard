const {client,sheetId} = require('../lib/sheets');
const {auditTables} = require('../lib/sheet-audit');

async function main() {
  const sheets = client(); // Read-only Google scope; this command never changes sheet data.
  const tabs = ['Orders','Sheet1','Viagogo'];
  const result = await sheets.spreadsheets.values.batchGet({spreadsheetId:sheetId(),
    ranges:['Orders!A:M','Sheet1!A:J','Viagogo!A:K'],valueRenderOption:'UNFORMATTED_VALUE'});
  const tables = Object.fromEntries(tabs.map((tab,index)=>[tab,result.data.valueRanges[index].values || []]));
  const report = auditTables(tables);
  console.log(JSON.stringify(report,null,2)); // Row numbers and issue types only; no customer/email data.
  if (Object.values(report).some(tab=>tab.issues.length)) process.exitCode=1;
}
main().catch(error=>{console.error('Sheet audit could not complete:',error.message);process.exitCode=2;});
