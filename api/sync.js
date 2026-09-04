const { syncFastmail } = require("../lib/importer");
const { applySecurityHeaders, authenticate, requireMutation, safeEqual } = require("../lib/security");

function authorisedCron(req) {
  const secret = process.env.CRON_SECRET;
  const header = String(req.headers.authorization || "");
  return Boolean(secret) && header.startsWith("Bearer ") && safeEqual(header.slice(7), secret);
}

module.exports = async (req, res) => {
  applySecurityHeaders(res);

  if (req.method === "GET") {
    if (!authorisedCron(req)) return res.status(401).send("Unauthorised");
  } else if (req.method === "POST") {
    if (!authenticate(req, res) || !requireMutation(req, res)) return;
  } else {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).send("Method not allowed");
  }

  try {
    const result = await syncFastmail();
    return res.status(200).json(result);
  } catch (error) {
    console.error("Fastmail sync error", error);
    return res.status(500).send("Inbox sync could not be completed.");
  }
};

module.exports._test = { authorisedCron };
