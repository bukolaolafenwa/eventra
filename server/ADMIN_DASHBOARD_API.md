# Eventra Admin Dashboard API

All endpoints are mounted under `/api/v1/admin` and require an authenticated
session whose role is `admin`.

## Overview

### `GET /overview?range=7d`

Accepted ranges are `7d`, `30d`, and `1y`. Returns:

- review-queue counts for events, organizers, promotions, and refunds;
- gross ticket sales, platform revenue, commission and promotion revenue;
- funds still held for upcoming events;
- active-event and trust-and-safety indicators;
- chart-ready revenue points;
- recent audited admin activity; and
- top organizers by gross sales.

### `GET /activities?limit=20`

Returns the latest audited admin decisions. `limit` is capped at 100.

### `GET /organizers/top?limit=5`

Returns organizers ranked by gross paid-ticket sales. `limit` is capped at 25.

The existing `GET /stats` endpoint remains available for backward
compatibility.

## Approvals

### `GET /approvals?type=all&limit=10`

`type` may be `all`, `events`, `organizers`, or `promotions`. Returns queue
counts and the requested queue sections.

### Organizer review

- `GET /organizers/pending?page=1&limit=10`
- `GET /organizers/:id/review`
- `PATCH /organizers/:id/approve`
- `PATCH /organizers/:id/reject`

### Event review

- `GET /events/pending?page=1&limit=10`
- `GET /events/:id/review`
- `PATCH /events/:id/approve`
- `PATCH /events/:id/reject`

Event rejection body:

```json
{
  "reason": "The venue information could not be verified."
}
```

### Promotion review

- `GET /promotions/pending?page=1&limit=10`
- `PATCH /events/:id/promotion/approve`
- `PATCH /events/:id/promotion/reject`

Promotion approval still requires confirmed promotion payment.

## Refund review

- `GET /refund-requests?status=pending&page=1&limit=10`
- `GET /refund-requests/:id`
- `PATCH /refund-requests/:id/approve`
- `PATCH /refund-requests/:id/reject`

List status may be `pending`, `approved`, `rejected`, `processed`, or `all`.

Refund approval body:

```json
{
  "confirm": true
}
```

Approval atomically claims the request and queues a Paystack refund. Eventra
does not mark the ticket or order as refunded at this stage. Signed Paystack
`refund.pending`, `refund.processing`, `refund.needs-attention`,
`refund.failed`, and `refund.processed` webhooks reconcile provider status.
Only `refund.processed` changes the ticket to `refunded` and updates the order's
refunded amount/status.

Refund rejection body:

```json
{
  "reason": "The request falls outside the event's refund policy."
}
```

## Existing moderation and finance routes

- `PATCH /events/:id/suspend`
- `PATCH /events/:id/unsuspend`
- `GET /users`
- `PATCH /users/:id/suspend`
- `PATCH /users/:id/unsuspend`
- `POST /payouts/events/:eventId/initiate`

## Monetary units

All stored and returned business amounts are whole Naira. Paystack conversion
to/from kobo happens only inside the Paystack/refund service boundary.
