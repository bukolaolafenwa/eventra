# Admin dashboard backend implementation notes

## Included

- Overview dashboard metrics for 7 days, 30 days, and 1 year
- Review-queue counts and consolidated approval data
- Organizer and event review-detail endpoints
- Pending promotion list and existing approval actions
- Refund list/detail, explicit approval confirmation, Paystack initiation,
  and signed webhook reconciliation
- Persistent admin activity/audit records
- Top-organizer ranking and recent activity data
- API reference in `ADMIN_DASHBOARD_API.md`

## Deliberate boundary

The uploaded source contains no payment-dispute model or Paystack dispute
ingestion. The overview therefore returns:

```json
{
  "openPaymentDisputes": null,
  "paymentDisputesAvailable": false
}
```

This avoids presenting fabricated dispute counts. A reports/disputes feature
can be added when its user submission workflow and data model are defined.

## Verification completed

- TypeScript: passed with `tsc --noEmit --incremental false`
- Focused Vitest suites: 3 files, 17 tests passed
- Existing non-database suites reached 37 passing tests
- Database-backed existing suites could not start in the delivery container
  because its downloaded MongoDB 7 test binary exits with code 100. These same
  suites passed on the source owner's Mac before this implementation.

Run the complete verification on the Mac after applying the files:

```bash
npx tsc --noEmit --incremental false
npm test
```

## Safe Git workflow

Create a feature branch from the latest `main` before copying these files:

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/admin-dashboard-backend
```

Do not copy `node_modules` or any `.env` file. Neither is included in the
delivery archive.
