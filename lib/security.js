const crypto = require("crypto");

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function applySecurityHeaders(res) {
  res.setHeader("Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
    "connect-src 'self'; img-src 'self' data:; form-action 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store");
}

function authenticate(req, res) {
  applySecurityHeaders(res);
  const password = process.env.PASSWORD;
  if (!password) {
    res.status(503).send("Dashboard authentication is not configured.");
    return false;
  }

  const header = String(req.headers.authorization || "");
  let supplied = "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      supplied = separator === -1 ? "" : decoded.slice(separator + 1);
    } catch (_) {
      supplied = "";
    }
  }

  if (!safeEqual(supplied, password)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Minion Tickets", charset="UTF-8"');
    res.status(401).send("Password required");
    return false;
  }
  return true;
}

function csrfToken() {
  const password = process.env.PASSWORD || "";
  return crypto.createHmac("sha256", password).update("minion-dashboard-csrf-v1").digest("hex");
}

function requireMutation(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).send("Method not allowed");
    return false;
  }
  if (!safeEqual(req.headers["x-csrf-token"], csrfToken())) {
    res.status(403).send("Invalid request token");
    return false;
  }
  return true;
}

module.exports = { applySecurityHeaders, authenticate, csrfToken, requireMutation, safeEqual };
