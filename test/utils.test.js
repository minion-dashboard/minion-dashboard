const test = require("node:test");
const assert = require("node:assert/strict");
const { pairedRows, parseMoney, toDate } = require("../lib/utils");

test("pairedRows keeps raw and formatted rows aligned across blanks", () => {
  const formatted = [["first"], [], ["third"]];
  const raw = [[1], [], [3]];
  const rows = pairedRows(formatted, raw).filter(({ row }) => row[0]);
  assert.deepEqual(rows.map(({ raw }) => raw[0]), [1, 3]);
});

test("parseMoney handles UK and European formatting", () => {
  assert.deepEqual(parseMoney("£1,234.56"), { cur: "£", amt: 1234.56 });
  assert.deepEqual(parseMoney("€1.234,56"), { cur: "€", amt: 1234.56 });
  assert.deepEqual(parseMoney("($25.00)"), { cur: "$", amt: -25 });
});

test("toDate rejects rolled-over calendar dates", () => {
  assert.equal(toDate("31/02/2026"), null);
  assert.equal(toDate("04/09/2026").toISOString(), "2026-09-04T00:00:00.000Z");
});
