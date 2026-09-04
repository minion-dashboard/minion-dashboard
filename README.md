# Minion Tickets Dashboard

A small Vercel-hosted dashboard backed by Google Sheets. It displays sales, orders,
profit and inventory estimates, and running costs.

## Routes

- `/` — Lysted and Viagogo sales plus overdue Viagogo payments
- `/orders` — imported purchase orders and confirmation checks
- `/pnl` — purchase/sale matching, realised profit, and unsold inventory
- `/costs` — recurring and one-off business costs

## Required Google Sheet tabs

| Tab | Columns used |
| --- | --- |
| `Sheet1` | A Event, C Date, D Order ID, G Quantity, H Payout, I Profit |
| `Viagogo` | A Event, C Date, D Order ID, G Quantity, H Payout, I Paid status |
| `Orders` | A Event, B Date, C Venue, D Section, E Row, F Seats, G Quantity, H Cost, I Order ID, J Account, K Status |
| `Costs` | A Item, B Category, C Provider, D Amount, E Cycle, F Start date, G Status, H Notes |

The `Costs` and `ImportLog` tabs are created automatically if they are missing.
Fastmail purchase confirmations, sale notifications, and Viagogo payment notices
populate the other tabs.

## Configuration

Set these in Vercel Project Settings under Environment Variables:

- `PASSWORD` — required. The dashboard refuses to load without it.
- `GOOGLE_CREDENTIALS` — required JSON credentials for a Google service account.
- `GOOGLE_SHEET_ID` — optional while using the existing sheet; recommended for new deployments.
- `FASTMAIL_API_TOKEN` — required for inbox sync. Create a Fastmail API token with
  read access to Mail under **Settings → Privacy & Security → API tokens**.
- `CRON_SECRET` — required for the protected daily sync. Use a separate random value
  of at least 32 characters.
- `FASTMAIL_IMPORT_DAYS` — optional lookback window from 1–90 days; defaults to `14`.

Share the Google Sheet with the service account email. Editor access is required for
confirming orders, cancelling payment tracking, and adding costs.

Never commit a real `.env` file or Google private key.

## Fastmail import

The **Sync inbox** button on the dashboard runs an immediate import. Vercel also
runs `/api/sync` once per day at `04:15 UTC`. It searches only recent mail from
Lysted, Viagogo, and Ticketmaster and imports:

- Lysted sales into `Sheet1`
- Viagogo sales into `Viagogo`
- Ticketmaster purchase confirmations into `Orders`
- Viagogo payment notices into the Paid status in `Viagogo`

The importer is duplicate-safe in two ways: `ImportLog` records each Fastmail
message ID, and destination rows are inserted or updated by marketplace order ID.
It preserves manual `Confirmed`, `Paid`, and `Cancelled` states.

### Moving from the old Google Apps Scripts

1. Deploy this version and add the Fastmail variables in Vercel.
2. Click **Sync inbox** once while the old Apps Script triggers are still enabled.
3. Check the destination tabs and the new `ImportLog` tab. Any message marked
   `Review` could not be parsed or matched and needs a manual check.
4. Only after the results are correct, disable the Apps Script triggers for
   `runTracker`, `checkViagogoPayments`, and `runOrders`.

Do not delete the old sheet rows. They are the history that the importer updates
against, which prevents a migration from creating duplicate orders.

## P&L safeguards

Purchases and sales are matched by event date and a conservative comparison of the
event name. Profit is withheld and the row is marked for review when a purchase is
missing, quantities are invalid, sold quantity exceeds purchased quantity, a value is
missing, the match is ambiguous, or currencies differ. No exchange-rate conversion is
performed.

## Local checks

```bash
npm install
npm run check
npm audit --omit=dev
```
