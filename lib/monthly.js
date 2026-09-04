const { positiveInteger, sumByCur, toDate } = require("./utils");
const TRACKING_START_MONTH = "2026-09";

function monthKey(value) {
  const date = toDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric", month: "2-digit", timeZone: "Europe/London"
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type).value;
  return `${part("year")}-${part("month")}`;
}

function monthLabel(key) {
  if (!key) return "Unknown purchase date";
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

function isTrackedPurchase(value, startMonth = TRACKING_START_MONTH) {
  const key = monthKey(value);
  return Boolean(key && key >= startMonth);
}

function bucketFor(buckets, key) {
  if (!buckets.has(key)) buckets.set(key, {
    key, label: monthLabel(key), orders: 0, tickets: 0, spend: [], profit: [], reviewEvents: 0
  });
  return buckets.get(key);
}

function resolvedProfit(summary) {
  const entered = (summary.sales || []).map(sale => sale.profit);
  if (entered.length && entered.every(Boolean) && new Set(entered.map(value => value.cur)).size === 1) {
    return { cur: entered[0].cur, amt: entered.reduce((total, value) => total + value.amt, 0) };
  }
  return summary.profitVal === null || !summary.profitCur
    ? null : { cur: summary.profitCur, amt: summary.profitVal };
}

function buildMonthly(orders, summaries) {
  const buckets = new Map();
  const trackedOrders = new Set(orders);
  orders.forEach(order => {
    const bucket = bucketFor(buckets, monthKey(order.purchaseDate));
    bucket.orders += 1;
    bucket.tickets += positiveInteger(order.qty) || 0;
    if (order.cost) bucket.spend.push(order.cost);
  });

  summaries.forEach(summary => {
    const allGroupOrders = summary.orders || [];
    const groupOrders = allGroupOrders.filter(order => trackedOrders.has(order));
    if (!groupOrders.length) return;
    if (summary.issue && summary.sales && summary.sales.length) {
      new Set(groupOrders.map(order => monthKey(order.purchaseDate)))
        .forEach(key => { bucketFor(buckets, key).reviewEvents += 1; });
    }
    const profit = resolvedProfit(summary);
    if (!profit) return;
    const weighted = allGroupOrders.map(order => ({
      order,
      weight: order.cost && Number.isFinite(order.cost.amt) ? Math.max(order.cost.amt, 0) : 0
    }));
    let totalWeight = weighted.reduce((total, item) => total + item.weight, 0);
    if (!totalWeight) {
      weighted.forEach(item => { item.weight = positiveInteger(item.order.qty) || 0; });
      totalWeight = weighted.reduce((total, item) => total + item.weight, 0);
    }
    if (!totalWeight) return;
    weighted.filter(item => trackedOrders.has(item.order)).forEach(item => {
      bucketFor(buckets, monthKey(item.order.purchaseDate)).profit.push({
        cur: profit.cur,
        amt: profit.amt * item.weight / totalWeight
      });
    });
  });

  return [...buckets.values()]
    .map(bucket => ({
      ...bucket,
      spendText: sumByCur(bucket.spend),
      profitText: sumByCur(bucket.profit),
      profitValue: bucket.profit.length && new Set(bucket.profit.map(value => value.cur)).size === 1
        ? bucket.profit.reduce((total, value) => total + value.amt, 0) : null
    }))
    .sort((left, right) => {
      if (!left.key) return 1;
      if (!right.key) return -1;
      return right.key.localeCompare(left.key);
    });
}

module.exports = { buildMonthly, isTrackedPurchase, monthKey, monthLabel, resolvedProfit, TRACKING_START_MONTH };
