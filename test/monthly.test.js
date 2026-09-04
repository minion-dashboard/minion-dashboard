const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMonthly, isTrackedPurchase, monthKey, monthLabel } = require("../lib/monthly");

test("uses the purchase timestamp rather than the event date", () => {
  assert.equal(monthKey("2026-09-04T23:30:00Z"), "2026-09");
  assert.equal(monthKey("2026-09-30T23:30:00Z"), "2026-10");
  assert.equal(monthLabel("2026-09"), "September 2026");
});

test("monthly tracking begins in September 2026", () => {
  assert.equal(isTrackedPurchase("2026-08-31T22:59:59Z"), false);
  assert.equal(isTrackedPurchase("2026-08-31T23:00:00Z"), true);
  assert.equal(isTrackedPurchase(""), false);
});

test("groups order count, tickets, spend and profit by purchase month", () => {
  const januaryOrder = { purchaseDate: "2026-01-12T10:00:00Z", qty: "2", cost: { cur: "£", amt: 200 } };
  const februaryOrder = { purchaseDate: "2026-02-03T10:00:00Z", qty: "1", cost: { cur: "£", amt: 100 } };
  const summaries = [{
    orders: [januaryOrder, februaryOrder], sales: [{}], issue: "",
    profitVal: 150, profitCur: "£"
  }];
  const months = buildMonthly([januaryOrder, februaryOrder], summaries);
  assert.deepEqual(months.map(month => ({
    key: month.key, orders: month.orders, tickets: month.tickets,
    spend: month.spendText, profit: month.profitText
  })), [
    { key: "2026-02", orders: 1, tickets: 1, spend: "£100.00", profit: "£50.00" },
    { key: "2026-01", orders: 1, tickets: 2, spend: "£200.00", profit: "£100.00" }
  ]);
});

test("keeps orders with missing dates visible and flags unsafe profit", () => {
  const order = { purchaseDate: "", qty: "2", cost: { cur: "$", amt: 100 } };
  const [month] = buildMonthly([order], [{
    orders: [order], sales: [{}], issue: "Mixed currencies", profitVal: null, profitCur: null
  }]);
  assert.equal(month.key, "");
  assert.equal(month.label, "Unknown purchase date");
  assert.equal(month.orders, 1);
  assert.equal(month.reviewEvents, 1);
  assert.equal(month.profitText, "-");
});

test("older purchases affect event profit without appearing in the report", () => {
  const oldOrder = { purchaseDate: "2026-08-20T10:00:00Z", qty: "2", cost: { cur: "£", amt: 200 } };
  const trackedOrder = { purchaseDate: "2026-09-02T10:00:00Z", qty: "1", cost: { cur: "£", amt: 100 } };
  const [september] = buildMonthly([trackedOrder], [{
    orders: [oldOrder, trackedOrder], sales: [{}], issue: "", profitVal: 150, profitCur: "£"
  }]);
  assert.equal(september.key, "2026-09");
  assert.equal(september.profitText, "£50.00");
});

test("complete entered sale profits override the calculated event profit", () => {
  const order = { purchaseDate: "2026-09-02T10:00:00Z", qty: "2", cost: { cur: "£", amt: 200 } };
  const [september] = buildMonthly([order], [{
    orders: [order], sales: [{ profit: { cur: "£", amt: 80 } }, { profit: { cur: "£", amt: -10 } }],
    issue: "", profitVal: 100, profitCur: "£"
  }]);
  assert.equal(september.profitText, "£70.00");
});

test("missing entered profit falls back to the safe calculation", () => {
  const order = { purchaseDate: "2026-09-02T10:00:00Z", qty: "2", cost: { cur: "£", amt: 200 } };
  const [september] = buildMonthly([order], [{
    orders: [order], sales: [{ profit: { cur: "£", amt: 80 } }, { profit: null }],
    issue: "", profitVal: 100, profitCur: "£"
  }]);
  assert.equal(september.profitText, "£100.00");
});
