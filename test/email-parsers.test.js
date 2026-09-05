const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyEmail, parseLysted, parseTicketmaster, parseViagogo
} = require("../lib/email-parsers");

test("classifies supported marketplace messages", () => {
  assert.equal(classifyEmail({ from: "sales@lysted.com", subject: "TICKETS SOLD: Event" }), "lysted");
  assert.equal(classifyEmail({ from: "orders@viagogo.com", subject: "You sold your tickets" }), "viagogo");
  assert.equal(classifyEmail({ from: "payments@viagogo.com", subject: "Your viagogo payment" }), "payment");
  assert.equal(classifyEmail({ from: "info@ticketmaster.co.uk", subject: "Order confirmed" }), "ticketmaster");
  assert.equal(classifyEmail({
    from: "forwarding@example.com",
    subject: "You Got Tickets To SAINT LEVANT - AFANDI WORLD TOUR",
    body: "Order # 50-27420/SEA"
  }), "ticketmaster");
  assert.equal(classifyEmail({ from: "news@example.com", subject: "Tickets" }), "");
});

test("parses a Lysted sale", () => {
  const record = parseLysted(
    "TICKETS SOLD: Oasis Live (Invoice #123456)",
    "Aug 11 2026, 7:30pm Wembley Stadium Section 102 Row A Per Ticket: 2 x $100.00 Payout: $180.00 Profit: $40.00"
  );
  assert.equal(record.order_id, "123456");
  assert.equal(record.event, "Oasis Live");
  assert.equal(record.date, "11/08/2026 19:30");
  assert.equal(record.qty, "2");
  assert.equal(record.payout, "$180.00");
  assert.equal(record.profit, "$40.00");
});

test("parses both Viagogo sale layouts", () => {
  const sold = parseViagogo(
    "You sold your tickets for Blur Live - Order #98765432",
    "Saturday, May 01, 2027 | 20:15\nWembley Stadium\nOrder ID: 98765432\nSection: 110\nRow | Seat(s) - B\n2 Ticket(s)\nPayment Total: £240.00"
  );
  assert.equal(sold.order_id, "98765432");
  assert.equal(sold.date, "01/05/2027 20:15");
  assert.equal(sold.qty, "2");
  assert.equal(sold.payout, "£240.00");

  const transfer = parseViagogo(
    "Please transfer the tickets - 87654321",
    "Order ID: 87654321\nEvent: The National\nVenue: The O2\nDate: Sunday 13 September 2026 18:30\nSection 101, Row C, Seat(s) 1 - 2, (2 Ticket(s))\nTotal Proceeds: £300.00"
  );
  assert.equal(transfer.order_id, "87654321");
  assert.equal(transfer.qty, "2");
  assert.equal(transfer.payout, "£300.00");
});

test("parses a labelled Ticketmaster purchase and keeps the catch-all account", () => {
  const record = parseTicketmaster(
    "Your ticket confirmation",
    "ORDER # 18-34731/UK5 SCHOOLBOY Q The O2 Sunday 13 September 2026 18:30 Ticket Quantity: 2 SECTION: 101 ROW: A SEATS: 5 - 6 Ticket(s): £75.00 x 2 Total (incl. fee): £170.00",
    "orders@example.com"
  );
  assert.equal(record.order_id, "18-34731/UK5");
  assert.equal(record.event, "SCHOOLBOY Q");
  assert.equal(record.venue, "The O2");
  assert.equal(record.date, "13/09/2026 18:30");
  assert.equal(record.qty, "2");
  assert.equal(record.cost, "£170.00");
  assert.equal(record.account, "orders@example.com");
  assert.equal(record.status, "");
});

test("parses a US Ticketmaster seat range", () => {
  const record = parseTicketmaster(
    "Order confirmed",
    "ORDER #: RE21749782 Taylor Swift Sat · Oct 31, 2026 · 7:00 PM Madison Square Garden Sec 110, Row B, Seat 7 - 10 $100.00 x 4 Total: $440.00"
  );
  assert.equal(record.order_id, "RE21749782");
  assert.equal(record.date, "31/10/2026 19:00");
  assert.equal(record.section, "110");
  assert.equal(record.row, "B");
  assert.equal(record.seats, "7-10");
  assert.equal(record.qty, "4");
  assert.equal(record.cost, "$440.00");
});

test("parses the Saint Levant US confirmation received on September 1", () => {
  const record = parseTicketmaster(
    "You Got Tickets To SAINT LEVANT - AFANDI WORLD TOUR",
    "Order Confirmed Order # 50-27420/SEA SAINT LEVANT - AFANDI WORLD TOUR " +
      "Mon · May 10, 2027 · 8:00 PM Paramount Theatre — Seattle, Washington " +
      "Get Directions Sec MEZ23, Row N, Seat 1 - 6 Payment Method VISA — 7758 Total: $294.60",
    "orders@example.com"
  );
  assert.equal(record.order_id, "50-27420/SEA");
  assert.equal(record.event, "SAINT LEVANT - AFANDI WORLD TOUR");
  assert.equal(record.date, "10/05/2027 20:00");
  assert.equal(record.section, "MEZ23");
  assert.equal(record.row, "N");
  assert.equal(record.seats, "1-6");
  assert.equal(record.qty, "6");
  assert.equal(record.cost, "$294.60");
});
