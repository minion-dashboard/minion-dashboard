const { client, sheetId } = require('./sheets');
const { authenticate, requireMutation } = require('./security');
const LOCK_TITLE = '_MinionWriteLock';

class SheetBusyError extends Error {
  constructor() {
    super('Another sheet update is running. Retry shortly. If this persists after a terminated import, follow the lock recovery instructions in README.');
    this.statusCode = 409;
  }
}

// Google Sheets enforces unique worksheet titles atomically across Vercel instances.
// Never steal a lock based on time: the original writer might still be running.
async function withSheetLock(sheets, spreadsheetId, operation) {
  let lockId;
  try {
    const result = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: {
      requests: [{ addSheet: { properties: { title: LOCK_TITLE, hidden: true,
        gridProperties: { rowCount: 1, columnCount: 1 } } } }]
    } });
    lockId = result.data.replies[0].addSheet.properties.sheetId;
  } catch (error) {
    if (Number(error.code || error.response?.status) === 400) {
      const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title)' });
      if ((metadata.data.sheets || []).some(sheet => sheet.properties.title === LOCK_TITLE)) {
        throw new SheetBusyError();
      }
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: {
      requests: [{ deleteSheet: { sheetId: lockId } }]
    } });
  }
}

function lockMutations(handler) {
  return async (req, res) => {
    if (req.method !== 'POST') return handler(req, res);
    if (!authenticate(req, res) || !requireMutation(req, res)) return;
    try {
      return await withSheetLock(client('https://www.googleapis.com/auth/spreadsheets'), sheetId(), () => handler(req, res));
    } catch (error) {
      if (error.statusCode === 409) return res.status(409).send(error.message);
      console.error('Sheet update failed', error.message);
      if (res.headersSent) return;
      return res.status(500).send('Sheet update could not be completed.');
    }
  };
}
module.exports = { LOCK_TITLE, SheetBusyError, withSheetLock, lockMutations };
