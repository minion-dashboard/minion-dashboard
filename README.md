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

The `Costs` tab is created automatically if it is missing. Another process must
populate the `Orders` tab; email or Ticketmaster ingestion is not part of this repository.

## Configuration

Set these in Vercel Project Settings under Environment Variables:

- `PASSWORD` — required. The dashboard refuses to load without it.
- `GOOGLE_CREDENTIALS` — required JSON credentials for a Google service account.
- `GOOGLE_SHEET_ID` — optional while using the existing sheet; recommended for new deployments.

Share the Google Sheet with the service account email. Editor access is required for
confirming orders, cancelling payment tracking, and adding costs.

Never commit a real `.env` file or Google private key.

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
