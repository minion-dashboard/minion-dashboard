const test = require("node:test");
const assert = require("node:assert/strict");
const { buildGroups, summarise, tokens } = require("../lib/finance");
const { dayKey, parseMoney } = require("../lib/utils");

function order(event, qty, cost, date = "20/09/2026") {
  return { event, qty, cost: parseMoney(cost), date, dayKey: dayKey(date), tokens: tokens(event), venue: "Arena" };
}
function sale(event, qty, payout, date = "20/09/2026") {
  return { event, qty, payout: parseMoney(payout), date, dayKey: dayKey(date), tokens: tokens(event) };
}

test("partial sales apportion cost and inventory correctly", () => {
  const [row] = summarise(buildGroups(
    [order("Coldplay Wembley", 4, "£400")],
    [sale("Coldplay", 2, "£300")]
  ), new Date("2026-09-04T00:00:00Z"));
  assert.equal(row.profitStr, "£100.00");
  assert.equal(row.roi, 50);
  assert.equal(row.unsoldQty, 2);
  assert.equal(row.unsoldCostStr, "£200.00");
});

test("unmatched sales are never presented as profit", () => {
  const [row] = summarise(buildGroups([], [sale("Unmatched Event", 2, "£300")]));
  assert.equal(row.profitVal, null);
  assert.equal(row.issue, "No matching purchase");
});

test("oversold and mixed-currency rows require review", () => {
  const [oversold] = summarise(buildGroups(
    [order("Artist A", 2, "£200")], [sale("Artist A", 3, "£450")]
  ));
  assert.equal(oversold.profitVal, null);
  assert.equal(oversold.issue, "Sold quantity exceeds purchased quantity");

  const [mixed] = summarise(buildGroups(
    [order("Artist B", 4, "£400")], [sale("Artist B", 2, "$500")]
  ));
  assert.equal(mixed.profitVal, null);
  assert.equal(mixed.issue, "Mixed currencies");
  assert.equal(mixed.unsoldCostStr, "£200.00");
});

test("one generic shared word does not merge different artists", () => {
  const groups = buildGroups(
    [order("Taylor Swift", 2, "£200")],
    [sale("Taylor Hawkins", 2, "£300")]
  );
  assert.equal(groups.length, 2);
});
