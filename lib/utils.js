function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pad(value) { return value < 10 ? "0" + value : String(value); }
function serialToDate(value) { return new Date(Date.UTC(1899, 11, 30) + value * 86400000); }

function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
  if (typeof value === "number" && Number.isFinite(value)) return serialToDate(value);
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(text)) {
    const iso = new Date(text);
    return Number.isNaN(iso.getTime()) ? null : iso;
  }
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day && date.getUTCHours() === hour && date.getUTCMinutes() === minute
    ? date : null;
}

function fmtDate(value) {
  const date = toDate(value);
  if (!date) return String(value || "");
  const time = date.getUTCHours() || date.getUTCMinutes()
    ? ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}` : "";
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}${time}`;
}

function dayKey(value) {
  const date = toDate(value);
  return date ? `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}` : "";
}

function parseMoney(value, defaultCurrency = "£") {
  if (typeof value === "number" && Number.isFinite(value)) return { cur: defaultCurrency, amt: value };
  const original = String(value == null ? "" : value).trim();
  if (!original) return null;
  const cur = (original.match(/[£$€]/) || [defaultCurrency])[0];
  const negative = original.includes("-") || /^\(.*\)$/.test(original);
  let numeric = original.replace(/[^0-9.,]/g, "");
  if (!numeric) return null;
  const lastDot = numeric.lastIndexOf(".");
  const lastComma = numeric.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    const decimal = lastDot > lastComma ? "." : ",";
    numeric = numeric.replace(decimal === "." ? /,/g : /\./g, "").replace(decimal, ".");
  } else if (lastComma !== -1) {
    const decimals = numeric.length - lastComma - 1;
    numeric = decimals > 0 && decimals <= 2 ? numeric.replace(",", ".") : numeric.replace(/,/g, "");
  } else if (lastDot !== -1) {
    const decimals = numeric.length - lastDot - 1;
    if (decimals === 3 && /^\d{1,3}(?:\.\d{3})+$/.test(numeric)) numeric = numeric.replace(/\./g, "");
  }
  const amount = Number(numeric);
  return Number.isFinite(amount) ? { cur, amt: negative ? -amount : amount } : null;
}

function money(cur, amount) {
  const sign = amount < 0 ? "-" : "";
  return sign + cur + Math.abs(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function sumByCur(values) {
  const totals = {};
  values.forEach(value => {
    if (value && Number.isFinite(value.amt)) totals[value.cur] = (totals[value.cur] || 0) + value.amt;
  });
  const currencies = Object.keys(totals);
  return currencies.length ? currencies.map(cur => money(cur, totals[cur])).join("  ") : "-";
}

function pairedRows(formatted, raw) {
  const formattedRows = formatted || [];
  const rawRows = raw || [];
  return formattedRows.map((row, index) => ({ row, raw: rawRows[index] || row, index }));
}

function positiveInteger(value, max = 10000) {
  if (!/^\d+$/.test(String(value || "").trim())) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= max ? number : null;
}

module.exports = { dayKey, esc, fmtDate, money, pairedRows, parseMoney, positiveInteger, serialToDate, sumByCur, toDate };
