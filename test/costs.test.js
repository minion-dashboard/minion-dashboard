const test = require("node:test");
const assert = require("node:assert/strict");
const costsHandler = require("../api/costs");

test("month-end renewals stay at the end of the target month", () => {
  const { nextRenewal } = costsHandler._test;
  assert.equal(
    nextRenewal("31/01/2024", "Monthly", new Date("2024-02-01T00:00:00Z")).toISOString(),
    "2024-02-29T00:00:00.000Z"
  );
  assert.equal(
    nextRenewal("31/01/2024", "Monthly", new Date("2024-03-01T00:00:00Z")).toISOString(),
    "2024-03-31T00:00:00.000Z"
  );
});

test("a renewal remains due throughout its renewal day", () => {
  const { nextRenewal } = costsHandler._test;
  assert.equal(
    nextRenewal("04/08/2026", "Monthly", new Date("2026-09-04T18:00:00Z")).toISOString(),
    "2026-09-04T00:00:00.000Z"
  );
});
