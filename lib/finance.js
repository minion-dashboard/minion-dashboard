const { money, positiveInteger, sumByCur, toDate } = require("./utils");

const NOISE = new Set([
  "the", "tour", "world", "live", "in", "of", "and", "a", "at", "presents",
  "extra", "date", "added", "concert", "show", "uk", "us", "featuring", "feat",
  "with", "years", "day", "pass", "night", "one", "two"
]);

function tokens(name) {
  return [...new Set(String(name || "").toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(token => token.length > 1 && !NOISE.has(token)))];
}

function matchScore(left, right) {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  const shared = left.filter(token => rightSet.has(token));
  if (!shared.length) return 0;
  if (shared.length === left.length && shared.length === right.length) return 1;
  if (shared.length >= 2) return 0.7 + (0.2 * shared.length / Math.max(left.length, right.length));
  if (Math.min(left.length, right.length) === 1 && shared[0].length >= 4) return 0.6;
  return 0;
}

function bestGroup(groups, item) {
  const ranked = groups
    .filter(group => group.dayKey === item.dayKey)
    .map(group => ({ group, score: Math.max(...group.aliases.map(alias => matchScore(alias, item.tokens))) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return { group: null, ambiguous: false };
  const ambiguous = ranked.length > 1 && ranked[0].score === ranked[1].score;
  return { group: ambiguous ? null : ranked[0].group, ambiguous };
}

function newGroup(item, kind, issue = "") {
  return {
    dayKey: item.dayKey,
    date: item.date,
    aliases: [item.tokens],
    name: item.event,
    venue: item.venue || "",
    orders: kind === "order" ? [item] : [],
    sales: kind === "sale" ? [item] : [],
    matchIssue: issue
  };
}

function addToGroup(group, item, kind) {
  group.aliases.push(item.tokens);
  if (kind === "order") {
    group.orders.push(item);
    if (item.event) group.name = item.event;
    if (item.venue) group.venue = item.venue;
  } else {
    group.sales.push(item);
  }
}

function buildGroups(orders, sales) {
  const groups = [];
  orders.forEach(item => {
    if (!item.dayKey) return groups.push(newGroup(item, "order", "Missing or invalid event date"));
    const match = bestGroup(groups.filter(group => group.orders.length), item);
    if (match.group) addToGroup(match.group, item, "order");
    else groups.push(newGroup(item, "order", match.ambiguous ? "Ambiguous purchase match" : ""));
  });

  sales.forEach(item => {
    if (!item.dayKey) return groups.push(newGroup(item, "sale", "Missing or invalid event date"));
    const purchaseMatch = bestGroup(groups.filter(group => group.orders.length), item);
    if (purchaseMatch.group) return addToGroup(purchaseMatch.group, item, "sale");
    if (purchaseMatch.ambiguous) return groups.push(newGroup(item, "sale", "Ambiguous event match"));

    const saleMatch = bestGroup(groups.filter(group => !group.orders.length), item);
    if (saleMatch.group) addToGroup(saleMatch.group, item, "sale");
    else groups.push(newGroup(item, "sale", "No matching purchase"));
  });
  return groups;
}

function summarise(groups, now = new Date()) {
  return groups.map(group => {
    const orderQty = group.orders.map(order => positiveInteger(order.qty));
    const saleQty = group.sales.map(sale => positiveInteger(sale.qty));
    const bought = orderQty.reduce((total, qty) => total + (qty || 0), 0);
    const sold = saleQty.reduce((total, qty) => total + (qty || 0), 0);
    const costs = group.orders.map(order => order.cost).filter(Boolean);
    const revenues = group.sales.map(sale => sale.payout).filter(Boolean);
    const currencies = new Set(costs.concat(revenues).map(value => value.cur));
    const singleCur = currencies.size === 1 ? [...currencies][0] : null;

    let issue = group.matchIssue;
    if (!issue && group.sales.length && !group.orders.length) issue = "No matching purchase";
    if (!issue && orderQty.some(qty => qty === null)) issue = "Invalid purchase quantity";
    if (!issue && saleQty.some(qty => qty === null)) issue = "Invalid sale quantity";
    if (!issue && group.orders.some(order => !order.cost)) issue = "Missing purchase cost";
    if (!issue && group.sales.some(sale => !sale.payout)) issue = "Missing sale payout";
    if (!issue && sold > bought) issue = "Sold quantity exceeds purchased quantity";
    if (!issue && currencies.size > 1) issue = "Mixed currencies";

    const costTotal = costs.reduce((total, value) => total + value.amt, 0);
    const revenueTotal = revenues.reduce((total, value) => total + value.amt, 0);
    const costOfSold = bought > 0 && sold > 0 && sold <= bought ? costTotal * sold / bought : 0;
    const profit = !issue && singleCur && sold > 0 ? revenueTotal - costOfSold : null;
    const roi = profit !== null && costOfSold > 0 ? profit / costOfSold * 100 : null;
    const unsoldQty = Math.max(bought - sold, 0);
    const unsoldRatio = bought > 0 ? unsoldQty / bought : 0;
    const unsoldMoney = costs.map(value => ({ cur: value.cur, amt: value.amt * unsoldRatio }));
    const eventDate = toDate(group.date);
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const daysToEvent = eventDate
      ? Math.round((Date.UTC(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate()) - todayUtc) / 86400000)
      : null;

    return {
      ...group,
      bought,
      sold,
      unsoldQty,
      costStr: sumByCur(costs),
      revStr: sumByCur(revenues),
      profitStr: profit === null ? "-" : money(singleCur, profit),
      profitVal: profit,
      profitCur: singleCur,
      roi,
      issue,
      unsoldMoney,
      unsoldCostStr: unsoldQty ? sumByCur(unsoldMoney) : "-",
      daysToEvent
    };
  });
}

module.exports = { buildGroups, matchScore, summarise, tokens };
