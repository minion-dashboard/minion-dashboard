const test = require("node:test");
const assert = require("node:assert/strict");
const { authorisedCron } = require("../api/sync")._test;

test("daily sync requires Vercel's bearer secret", () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "cron-secret-for-testing";
  assert.equal(authorisedCron({ headers: { authorization: "Bearer cron-secret-for-testing" } }), true);
  assert.equal(authorisedCron({ headers: { authorization: "Bearer wrong" } }), false);
  assert.equal(authorisedCron({ headers: {} }), false);
  if (previous === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previous;
});
