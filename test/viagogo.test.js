const test = require("node:test");
const assert = require("node:assert/strict");
const { normaliseProfit } = require("../api/viagogo")._test;

test("normalises manual Viagogo profit and losses", () => {
  assert.equal(normaliseProfit("120"), "£120.00");
  assert.equal(normaliseProfit("120", "$"), "$120.00");
  assert.equal(normaliseProfit("$1,234.50"), "$1,234.50");
  assert.equal(normaliseProfit("-£25"), "-£25.00");
  assert.equal(normaliseProfit(""), "");
});

test("rejects invalid or implausibly large profit", () => {
  assert.equal(normaliseProfit("not money"), null);
  assert.equal(normaliseProfit("£10000001"), null);
});
