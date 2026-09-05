const test = require("node:test");
const assert = require("node:assert/strict");
const { currencySymbol, idAppears, mergeRecords } = require("../lib/importer");

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
