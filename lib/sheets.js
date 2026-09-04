const { google } = require("googleapis");

const DEFAULT_SHEET_ID = "1HCAL0ei_RrxpIdoPC_IY_qzhPTsukwaTGBnIf8lZJQo";

function sheetId() {
  return process.env.GOOGLE_SHEET_ID || DEFAULT_SHEET_ID;
}

function client(scope = "https://www.googleapis.com/auth/spreadsheets.readonly") {
  if (!process.env.GOOGLE_CREDENTIALS) throw new Error("Google Sheets credentials are missing");
  let credentials;
  try {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  } catch (_) {
    throw new Error("Google Sheets credentials are invalid");
  }
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google Sheets credentials are incomplete");
  }
  const auth = new google.auth.JWT(credentials.client_email, null, credentials.private_key, [scope]);
  return google.sheets({ version: "v4", auth });
}

module.exports = { client, sheetId };
