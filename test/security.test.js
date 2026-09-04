const test = require("node:test");
const assert = require("node:assert/strict");
const { authenticate, csrfToken, requireMutation } = require("../lib/security");

function response() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; }
  };
}

test("authentication fails closed without PASSWORD", () => {
  const previous = process.env.PASSWORD;
  delete process.env.PASSWORD;
  const res = response();
  assert.equal(authenticate({ headers: {} }, res), false);
  assert.equal(res.statusCode, 503);
  if (previous !== undefined) process.env.PASSWORD = previous;
});

test("valid authentication and CSRF token are accepted", () => {
  const previous = process.env.PASSWORD;
  process.env.PASSWORD = "a-long-test-password";
  const auth = Buffer.from("user:a-long-test-password").toString("base64");
  assert.equal(authenticate({ headers: { authorization: `Basic ${auth}` } }, response()), true);
  assert.equal(requireMutation({ method: "POST", headers: { "x-csrf-token": csrfToken() } }, response()), true);
  if (previous === undefined) delete process.env.PASSWORD;
  else process.env.PASSWORD = previous;
});
