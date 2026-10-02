# Minion Tickets Dashboard

A small Vercel-hosted dashboard backed by Google Sheets. It displays sales, orders,
profit and inventory estimates, and running costs.

## Routes

- `/` — Lysted and Viagogo sales plus overdue Viagogo payments
- `/orders` — redirects to `/monthly`
- `/viagogo` — all Viagogo sales with editable manual profit
- `/monthly` — orders, tickets, spend, and realised profit by purchase month
- `/pnl` — purchase/sale matching, realised profit, and unsold inventory
- `/costs` — recurring and one-off business costs

## Required Google Sheet tabs

| Tab | Columns used |
| --- | --- |
| `Sheet1` | A Event, C Date, D Order ID, G Quantity, H Payout, I Profit, J Currency |
| `Viagogo` | A Event, C Date, D Order ID, G Quantity, H Payout, I Paid status, J Manual profit, K Currency |
| `Orders` | A Event, B Event date, C Venue, D Section, E Row, F Seats, G Quantity, H Cost, I Order ID, J Account, K Status, L Purchase date, M Currency |
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
- `FASTMAIL_MAX_MESSAGES` — optional scan limit per mail account from 1–100,000; defaults to `5000`. Capped scans display a partial-sync warning.

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
It preserves existing order details, confirmed quantities, payment statuses, and manual profits.
Existing populated cells are never overwritten by import replay; missing fields are filled,
and changed cells are written in batches. Newest notifications supply the newest nonempty
fields for new orders. Existing conflicting details require manual review rather than
silently replacing financial history. Existing duplicate IDs stop the import; no rows are
automatically deleted.

The inbox scan checks headers across every mail account available to the API
token, reads multiple result pages (up to 5,000 messages per account), and only
downloads the bodies of relevant messages. This covers confirmations in shared
or catch-all mailboxes as well as forwarded US Ticketmaster mail whose sender is
not searchable as Ticketmaster.
Both plain-text and HTML email sections are parsed together because some US
Ticketmaster confirmations keep the order details only in the HTML section.

New Ticketmaster imports store a reliable purchase timestamp in column L of `Orders`:
an explicitly labelled purchase date, the original forwarded message's dated header,
or the original send time of a direct Ticketmaster confirmation (receipt time is the
fallback only for direct confirmations). A forwarded confirmation without a reliable
original timestamp remains undated and marked Review. The monthly page does not use
legacy ImportLog receipt timestamps as guessed purchase dates.
Monthly reporting starts on 1 September 2026 in Europe/London. Older and undated
orders are excluded from totals; undated orders remain visible for correction. Use
the purchase-date button to set a verified date. Existing dates are preserved: review
historical forwarded orders whose dates were assigned by the old importer.
Purchase spend and profit are displayed separately in GBP, USD, and EUR; currencies
are never converted or combined into a misleading total.
The Monthly page lists current orders, has a month selector (including all tracked
months), and shows purchases needing a date or currency. It includes quantity
confirmation, purchase-date correction, and currency correction controls. The importer stores order
currency separately in column M so Google Sheets column formatting cannot relabel
a dollar order as pounds. Sales currency is stored separately in Sheet1 J and Viagogo K.
Pages read raw values rather than treating display formatting as proof of currency.
Unlabelled legacy amounts without verified currency are excluded from financial totals
until reviewed. Recent confirmations are safely re-read on the next sync to fill missing
metadata without changing financial history or manual corrections. Completed sale emails
can backfill currency only when their payout matches the existing amount.
New reserved columns must be empty or have the expected header; the importer stops
rather than overwriting a user column.

Viagogo emails do not contain profit. Use **Manage profits** from the Viagogo
panel to enter or edit it. Entered values are stored in column J and feed the
Viagogo dashboard total. Both Monthly and P&L profit use only the profit supplied by Lysted
and profit manually entered for Viagogo; it never substitutes an estimated
payout-minus-cost figure. Missing profit entries are flagged for review.

### Moving from the old Google Apps Scripts

1. Make a copy of the spreadsheet and verify the required columns before upgrading.
2. Disable the old Apps Script triggers (`runTracker`, `checkViagogoPayments`, and
   `runOrders`) before using the new importer. Those scripts do not participate in
   its write lock; running both can create duplicates or overwrite manual edits.
3. Deploy this version with the Fastmail variables in Vercel, then click **Sync inbox**.
4. Check the destination tabs and ImportLog. Review undated orders, unknown currencies,
   duplicate IDs, and Review entries without deleting existing history.

Do not delete the old sheet rows. They are the history that the importer updates
against, which prevents a migration from creating duplicate orders.

## P&L safeguards

Purchases and sales are matched by event date and a conservative comparison of the
event name. Profit is withheld and the row is marked for review when a purchase is
missing, quantities are invalid, sold quantity exceeds purchased quantity, a value is
missing, or the match is ambiguous. Supplied and manually entered profits are never
replaced with payout-minus-cost estimates. Missing profit is flagged; known supplied
profit can still be displayed separately. A profit is allocated only to purchases in
its own currency, with per-currency quantity validation; no GBP/USD fallback or
exchange-rate conversion is performed. Cancelled Viagogo sales are excluded from
financial totals on every page but retained in the sheet and profits management table.

## Local checks

```bash
npm ci
npm run check
npm audit --omit=dev
```

## Write protection and recovery

All imports and dashboard POST edits share a cross-instance Google Sheets lock. It
atomically creates the hidden `_MinionWriteLock` worksheet before writing and removes
only that worksheet on completion. Competing writers receive HTTP 409 and should retry
after the active operation finishes. No third-party database or additional credentials
are required. The lock does not coordinate manual spreadsheet edits or old Apps Scripts:
avoid direct edits while an import is running.

A hard-terminated Vercel function or failed lock deletion can leave the lock in place.
It is deliberately not stolen on a timer, because a slow writer could still be active.
For recovery, pause cron and manual syncs, confirm in Vercel logs that no writer remains
active (including older deployments), then unhide and delete only `_MinionWriteLock`.
Resume imports and retry. Never delete business-data tabs or remove a live writer's lock.

## Sheet audit and deployment

With GOOGLE_CREDENTIALS and GOOGLE_SHEET_ID available locally, run `npm run audit:sheet`.
This is read-only and prints record counts, row numbers, missing metadata columns,
duplicate IDs, invalid purchase dates, missing currency/profit, and currency conflicts.
It does not print credentials, email bodies, order IDs, or financial amounts. Exit 0
means no detected data issues, 1 means review is needed, and 2 means the audit could
not complete. Back up the sheet and review legacy data before enabling the upgraded
importer; dates and currencies that cannot be proved are never auto-guessed.

Sales, Monthly, and P&L use one raw batched read per page. Imports reuse a single table
snapshot under the lock, batch header/cell changes, skip unchanged rows and completed
log entries, and index payment order IDs rather than comparing every notice with every
sale. These changes reduce API traffic without caching stale business data between requests.

Code becomes live only after a Vercel deployment. Push a reviewed commit to the
configured production branch, or create a preview first if that Git integration is
configured. Environment-variable changes require redeployment. A preview must use a
separate test sheet and should not run live inbox imports. The single daily cron remains
`15 4 * * *` (04:15 UTC); manual Sync remains available. Validate deployed page totals,
manual corrections, and a controlled import before relying on the production schedule.
