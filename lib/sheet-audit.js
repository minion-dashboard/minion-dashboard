const { sheetMoney, saleValues, activeSale, toDate } = require('./utils');
const { usableSaleName } = require('./importer');

function auditTables(tables) {
  const report = {};
  for (const [tab, idColumn] of [['Orders',8],['Sheet1',3],['Viagogo',3]]) {
    const rows = tables[tab] || [];
    const issues = [];
    const ids = new Map();
    let records = 0;
    rows.slice(1).forEach((row, index) => {
      const number = index + 2;
      const id = String(row[idColumn] || '').trim();
      if (!id) return;
      records++;
      if (ids.has(id)) issues.push({ row:number, issue:'Duplicate order ID', firstRow:ids.get(id) });
      else ids.set(id,number);
      if (tab === 'Orders') {
        if (!toDate(row[11])) issues.push({row:number,issue:'Purchase date missing or invalid'});
        if (!sheetMoney(row[7],row[7],row[12])) issues.push({row:number,issue:'Cost or currency needs review'});
      } else {
        const {payout,profit} = saleValues(row,row,tab==='Sheet1'?8:9);
        if (!payout) issues.push({row:number,issue:'Payout or currency needs review'});
        if (activeSale(row) && !profit) issues.push({row:number,issue:row[tab==='Sheet1'?8:9] === '' || row[tab==='Sheet1'?8:9] == null ? 'Supplied or manual profit missing' : 'Profit or currency needs review'});
        if (profit && payout && profit.cur!==payout.cur) issues.push({row:number,issue:'Profit currency differs from payout'});
        if (!usableSaleName(row[0])) issues.push({row:number,issue:'Event name needs review'});
      }
    });
    const reserved = tab === 'Orders' ? [[11,'Purchase date'],[12,'Currency']]
      : tab === 'Sheet1' ? [[9,'Currency']] : [[9,'Profit'],[10,'Currency']];
    const columnsNeeded = [];
    reserved.forEach(([column, expected]) => {
      const header = rows[0]?.[column];
      if (!header) columnsNeeded.push({column:column+1,header:expected});
      else if (header!==expected) issues.push({row:1,column:column+1,issue:'Reserved header conflict'});
    });
    report[tab] = {records,columnsNeeded,issues};
  }
  return report;
}
// Only a symbol in the actual stored amount proves currency. Sheet formatting is not evidence.
function planCurrencyBackfill(tables) {
  const changes = [];
  for (const [tab, idColumn, amountColumn, currencyColumn] of [['Orders',8,7,12],['Sheet1',3,7,9],['Viagogo',3,7,10]]) {
    (tables[tab] || []).slice(1).forEach((row,index) => {
      if (!String(row[idColumn] || '').trim() || row[currencyColumn]) return;
      if (String(row[amountColumn] || '').startsWith('=')) return;
      const parsed = sheetMoney(row[amountColumn]);
      if (!parsed) return;
      changes.push({ range:`${tab}!${String.fromCharCode(65+currencyColumn)}${index+2}`, values:[[parsed.cur]] });
    });
  }
  return changes;
}
module.exports = { auditTables, planCurrencyBackfill };
