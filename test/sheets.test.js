const test = require("node:test");
const assert = require("node:assert/strict");

test("Sheets client registers the service-account identity", () => {
  const previous = process.env.GOOGLE_CREDENTIALS;
  process.env.GOOGLE_CREDENTIALS = JSON.stringify({
    client_email: "service-account@example.iam.gserviceaccount.com",
    private_key: "test-private-key"
  });

  delete require.cache[require.resolve("../lib/sheets")];
  const { client } = require("../lib/sheets");
  const sheets = client();
  assert.equal(sheets.context._options.auth.email, "service-account@example.iam.gserviceaccount.com");
  assert.deepEqual(sheets.context._options.auth.scopes, ["https://www.googleapis.com/auth/spreadsheets.readonly"]);

  if (previous === undefined) delete process.env.GOOGLE_CREDENTIALS;
  else process.env.GOOGLE_CREDENTIALS = previous;
});
