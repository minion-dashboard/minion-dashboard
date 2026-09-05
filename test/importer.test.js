const test = require("node:test");
const assert = require("node:assert/strict");
const { currencySymbol, idAppears, mergeRecords, writeImportLog } = require("../lib/importer");

test("preserves the currency stated in the Ticketmaster total", () => {
  assert.equal(currencySymbol("$780.00"), "$");
  assert.equal(currencySymbol("£120.00"), "£");
  assert.equal(currencySymbol("€450.00"), "€");
  assert.equal(currencySymbol("780.00"), "");
});

test("payment matching requires a complete order ID", () => {
  assert.equal(idAppears("Payment for order 12345678 is complete", "12345678"), true);
  assert.equal(idAppears("Payment for order 9123456780 is complete", "12345678"), false);
  assert.equal(idAppears("Paid: 18-34731/UK5", "18-34731/UK5"), true);
});

test("duplicate marketplace messages merge by external order ID", () => {
  const result = mergeRecords([
    { record: { order_id: "42", event: "Artist", payout: "£100.00" } },
    { record: { order_id: "42", venue: "Arena", payout: "" } }
  ]);
  assert.deepEqual(result, [{ order_id: "42", event: "Artist", payout: "£100.00", venue: "Arena" }]);
});

test("a reviewed message is updated when a later sync imports it", async () => {
  const batchUpdates = [];
  const appends = [];
  const sheets = { spreadsheets: { values: {
    batchUpdate: async request => batchUpdates.push(request),
    append: async request => appends.push(request)
  } } };
  const header = ["Fastmail Message ID", "Type", "External ID", "Received", "Imported", "Status"];
  const reviewed = ["m1", "ticketmaster", "", "2026-09-01", "2026-09-05", "Review"];
  const imported = ["m1", "ticketmaster", "50-27420/SEA", "2026-09-01", "2026-09-05", "Imported"];
  const fresh = ["m2", "ticketmaster", "51-11111/SEA", "2026-09-01", "2026-09-05", "Imported"];
  await writeImportLog(sheets, "sheet-1", [header, reviewed], [imported, fresh]);
  assert.equal(batchUpdates[0].requestBody.data[0].range, "ImportLog!A2:F2");
  assert.deepEqual(batchUpdates[0].requestBody.data[0].values, [imported]);
  assert.deepEqual(appends[0].requestBody.values, [fresh]);
});
