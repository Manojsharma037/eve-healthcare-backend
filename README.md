# EVE Healthcare Backend

## Overview

EVE Healthcare Backend is a REST API for booking diagnostic tests at diagnostic
centres and processing **simulated** payments for those bookings. It was built
incrementally as an assignment project.

It supports user registration/login, browsing diagnostic centres and their
tests, creating and managing bookings, a mock payment endpoint, and an
**idempotent** payment-provider webhook. Money is handled with fixed-precision
decimals, identity is derived from JWTs (never from the request body), and
multi-step operations use database transactions for consistency.

## Features

- User signup & login with JWT authentication and bcrypt password hashing.
- Zod request validation on every write endpoint (body and UUID path params).
- Diagnostic centre & test management (create + public retrieval).
- Bookings with ownership enforcement, server-derived amount, and status transitions.
- Mock payment endpoint that atomically records a payment and updates the booking.
- Idempotent payment webhook that safely handles duplicate and concurrent deliveries.
- Centralized error handling with clean JSON responses (no stack traces or raw DB errors).
- `GET /health` service health check.

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Language:** JavaScript (CommonJS)
- **Database:** PostgreSQL
- **ORM:** Prisma `6.19.3`
- **Auth:** JSON Web Tokens (`jsonwebtoken`)
- **Password hashing:** `bcryptjs`
- **Validation:** `zod`
- **Config:** `dotenv`
- **Dev:** `nodemon`

## Architecture

The project follows a simple, layered structure.

```
Client
  → Express route            (src/routes/*.routes.js)
    → Validation middleware   (Zod: body + UUID params)
    → Authentication          (JWT Bearer — only on protected routes)
    → Controller              (business rules)
    → Prisma client           (src/prisma.js — single shared instance)
    → PostgreSQL
  → JSON response
(unmatched route → 404 handler → centralized error handler)
```

```
src/
├── app.js                 # Express app: JSON parsing, routes, error handlers
├── server.js              # Loads env, starts HTTP server
├── prisma.js              # Shared PrismaClient instance
├── routes/                # auth, centre, test, booking, payment
├── controllers/           # auth, centre, test, booking, payment, webhook
├── middleware/            # auth (JWT), validate (Zod), error (404 + central)
└── validators/            # Zod schemas (auth, centre, test, booking, payment, webhook, common)
```

**Webhook flow (separate from the above):** the webhook endpoint does **not**
use JWT authentication because it represents a payment-provider callback rather
than a logged-in user. It relies on request validation plus an idempotency key
(`eventId`) and a database transaction instead. See
[Webhook and Idempotency](#webhook-and-idempotency).

## Database Schema

Relationships (simple terms):

- **User → Bookings** — one user has many bookings.
- **DiagnosticCentre → DiagnosticTests** — one centre offers many tests.
- **DiagnosticTest → Bookings** — one test can be booked many times.
- **DiagnosticCentre → Bookings** — a booking also records its centre directly.
- **Booking → Payment** — one booking has at most one payment (1:1).
- **WebhookEvent** — standalone table used only for webhook idempotency tracking.

Enums:

- `BookingStatus`: `PENDING`, `CONFIRMED`, `FAILED`, `CANCELLED`
- `PaymentStatus`: `SUCCESS`, `FAILED`

Important constraints:

- `User.email` is **unique**.
- `Payment.bookingId` is **unique** → at most one payment per booking.
- `WebhookEvent.eventId` is **unique** → each webhook event processed at most once.
- Monetary fields (`DiagnosticTest.price`, `Booking.amount`, `Payment.amount`) use
  `Decimal(10,2)`.
- Foreign keys use `onDelete: Restrict` so booking/payment history is never
  accidentally cascade-deleted.

## API Endpoints

Protected endpoints require an `Authorization: Bearer <JWT>` header.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | Public | Service health check |
| POST | `/api/auth/signup` | Public | Register a new user |
| POST | `/api/auth/login` | Public | Log in, receive a JWT |
| POST | `/api/centres` | JWT | Create a diagnostic centre |
| GET | `/api/centres` | Public | List all centres |
| GET | `/api/centres/:id` | Public | Get a centre and its tests |
| POST | `/api/centres/:centreId/tests` | JWT | Create a test under a centre |
| GET | `/api/centres/:centreId/tests` | Public | List a centre's tests |
| GET | `/api/tests/:id` | Public | Get a test and its centre |
| POST | `/api/bookings` | JWT | Create a booking (starts `PENDING`) |
| GET | `/api/bookings` | JWT | List the current user's bookings |
| GET | `/api/bookings/:id` | JWT | Get one of the user's own bookings |
| PATCH | `/api/bookings/:id/cancel` | JWT | Cancel the user's own booking |
| POST | `/api/payments` | JWT | Simulate a payment for a booking |
| POST | `/api/payments/webhook` | Public* | Simulated payment-provider callback |

\* The webhook is intentionally not JWT-protected; it is guarded by validation
and idempotency (see below).

## API Documentation (Swagger)

Interactive OpenAPI 3 documentation for **all** of the endpoints above is served
by the running application:

- **Swagger UI:** `http://localhost:5000/api/docs`
- **Raw OpenAPI spec (JSON):** `http://localhost:5000/api/docs.json`

Start the app (`npm run dev` or `npm start`) and open `/api/docs` in a browser.
Each endpoint lists its summary, parameters, request body, required fields,
field types/enums (`BookingStatus`, `PaymentStatus`) and response codes.

To try protected (JWT) endpoints from the UI:

1. Call `POST /api/auth/login` and copy the `token` from the response.
2. Click **Authorize** (top right), paste the token, and confirm.
3. Use **Try it out** on any endpoint; the `Authorization: Bearer <token>`
   header is sent automatically. The webhook is documented as unauthenticated,
   matching its actual behavior.

The spec is maintained as a single module at `src/docs/openapi.js` and reflects
the current API (request/response shapes are not generated from code, so keep it
in sync when endpoints change). It documents the existing APIs only — it does
not change any API behavior.

## Authentication Flow

1. **Signup** — `POST /api/auth/signup` with `{ name, email, password }`. The
   password is hashed with bcrypt; the plaintext is never stored. The response
   returns the created user **without** the password hash.
2. **Login** — `POST /api/auth/login` with `{ email, password }`. The supplied
   password is compared against the stored bcrypt hash. On success, a JWT
   containing the `userId` (signed with `JWT_SECRET`, expiring per
   `JWT_EXPIRES_IN`) is returned. Invalid credentials return a generic `401`
   that never reveals whether the email or the password was wrong.
3. **Protected routes** — send the token as `Authorization: Bearer <JWT>`. The
   auth middleware verifies the token, loads a password-free user record, and
   attaches it to `req.user`. Missing/malformed/expired tokens return `401`.

## Booking Flow

1. User logs in and obtains a JWT.
2. User browses centres/tests (`GET /api/centres`, `GET /api/tests/:id`, …).
3. User creates a booking with `{ testId, centreId, appointmentDateTime }`.
4. The server validates that the test belongs to the centre and that the
   appointment is in the future, then **reads the price from the database**
   (`test.price`) to set the booking amount — the client cannot choose the
   amount or the `userId`.
5. The booking is created with status `PENDING`.
6. A subsequent payment (or webhook) moves the booking to `CONFIRMED` (SUCCESS)
   or `FAILED` (FAILED). Users may cancel their own `PENDING`/`CONFIRMED`
   bookings, moving them to `CANCELLED`.

## Payment Flow

`POST /api/payments` (JWT required) simulates a payment.

- Body: `{ bookingId, status }` where `status` is `SUCCESS` or `FAILED`.
- The booking must belong to the authenticated user and be `PENDING`.
- The amount is taken from `booking.amount` (never the request body).
- A mock `transactionId` (`txn_<uuid>`) is generated on the backend.
- `SUCCESS` → Payment `SUCCESS` + Booking `CONFIRMED`; `FAILED` → Payment
  `FAILED` + Booking `FAILED`.
- The payment creation and booking update run inside **one Prisma transaction**,
  so they either both commit or both roll back.

## Webhook and Idempotency

`POST /api/payments/webhook` simulates the callback a payment provider sends
after processing a payment.

- **What a webhook is:** a server-to-server HTTP call the provider makes to
  notify us of a payment result — it is not the patient's browser/JWT request.
- **Why duplicates happen:** providers deliver **at least once**. Network
  retries, timeouts, or two near-simultaneous deliveries mean the same event
  can arrive more than once.
- **Why `eventId`:** each event carries a unique `eventId`. We use it as an
  idempotency key so the same event is processed only once.
- **How UNIQUE `eventId` prevents duplicates:** `WebhookEvent.eventId` has a
  database **UNIQUE** constraint. A first-time event inserts its `eventId`;
  a duplicate insert is rejected by the database, so the business operation
  cannot run twice — this holds even for concurrent deliveries, because the DB
  constraint (not an application-level check) is the final arbiter.
- **Why a transaction:** creating the `WebhookEvent`, creating the `Payment`,
  and updating the `Booking` happen in a single Prisma transaction. If any step
  fails, everything rolls back — so an event is never marked "processed" unless
  the payment and booking updates also succeeded (a later retry can then work).
- **Concurrency:** if two identical deliveries race, exactly one wins and
  processes the event; the other detects the already-recorded event (via the
  unique constraint / re-check) and returns a clean idempotent `200` without
  creating a second payment or re-mutating the booking.

Only `eventId`, `bookingId`, and `status` are accepted. `amount` comes from
`booking.amount`; `transactionId` is generated on the backend.

Example:

```
First delivery:
  evt_123 → event not seen → process payment → confirm booking → save WebhookEvent(evt_123) → 200

Duplicate delivery:
  evt_123 → already processed → 200 "Webhook already processed" → no duplicate payment, no state change
```

## Validation and Error Handling

Handled cases (all returning clean JSON, no stack traces or raw DB errors):

- Invalid request body → `400` (Zod validation errors with field details).
- Invalid UUID path parameter → `400`.
- Missing/malformed/expired JWT → `401`.
- Accessing/modifying another user's booking → `404` (no information leak).
- Non-existent centre / test / booking → `404`.
- Invalid state (e.g. paying a non-`PENDING` booking, cancelling a `FAILED`
  booking, webhook on a terminal booking) → `400`.
- Database constraint conflicts (e.g. duplicate email, duplicate payment per
  booking) → handled via a centralized error handler (`409`/idempotent as
  appropriate).
- Unmatched routes → `404`.

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | HTTP server port | `5000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://USER:PASSWORD@localhost:5432/eve_healthcare?schema=public` |
| `JWT_SECRET` | Secret used to sign JWTs | *(a long random string)* |
| `JWT_EXPIRES_IN` | JWT lifetime | `1d` |

Example `.env` (no real credentials):

```env
PORT=5000
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/eve_healthcare?schema=public"
JWT_SECRET="replace-with-a-long-random-secret"
JWT_EXPIRES_IN=1d
```

A template is provided in `.env.example`. The real `.env` is git-ignored.

## Local Setup

Prerequisites: Node.js (v18+) and a running PostgreSQL instance.

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file, then edit its values
cp .env.example .env        # Windows: copy .env.example .env

# 3. Ensure the PostgreSQL database in DATABASE_URL exists
#    (create it in psql/pgAdmin if needed, e.g. a database named eve_healthcare)

# 4. Apply database migrations (creates all tables) and generate the client
npx prisma migrate dev
#    (npm run prisma:generate is also available to (re)generate the client)

# 5. Start the development server (auto-reload)
npm run dev
#    Production-style start:
npm start
```

Verify it is running:

```bash
curl http://localhost:5000/health
# { "status": "ok", "service": "EVE Healthcare Backend" }
```

## Running with Docker

The project ships a self-contained Docker Compose stack (`Dockerfile` +
`docker-compose.yml`) with two services: **postgres** and **backend**. This
environment is **completely separate** from any PostgreSQL you run locally — it
has its own containerized database and its own named volume, and never reads
from or writes to your local development/test databases.

**Prerequisites:** Docker Desktop (which includes Docker Compose).

Run the stack:

```bash
docker compose up --build
```

This will:

1. Start PostgreSQL with a healthcheck and a persistent named volume.
2. Build the backend image (installs deps from `package-lock.json` and generates
   the Prisma Client).
3. Wait for PostgreSQL to become healthy, then apply the committed migrations
   with `prisma migrate deploy` (safe, non-destructive — never `reset`).
4. Start the API server.

Once it's up:

| What | URL |
|------|-----|
| Health check | `http://localhost:5000/health` |
| Swagger UI | `http://localhost:5000/api/docs` |
| OpenAPI spec (JSON) | `http://localhost:5000/api/docs.json` |

Stop the stack (keeps the database volume):

```bash
docker compose down
```

Stop **and delete the Docker PostgreSQL volume** (only when you intentionally
want to reset the Docker database):

```bash
docker compose down -v
```

> ⚠️ `docker compose down -v` removes the **Docker** PostgreSQL volume
> (`eve_healthcare_pgdata`) only. This has **no effect** on your local
> PostgreSQL databases — they are entirely separate.

**Credentials / secrets.** `docker-compose.yml` uses safe non-secret defaults so
`docker compose up --build` works out of the box; no secrets are committed. To
customize, copy `.env.docker.example` to `.env.docker` (git-ignored) and run
`docker compose --env-file .env.docker up --build`. The backend's JWT secret uses
a namespaced variable (`EVE_DOCKER_JWT_SECRET`) so it can never accidentally pick
up your local development `.env`'s `JWT_SECRET`. Inside the container the backend
connects to PostgreSQL via the compose **service name** (`postgres:5432`), not
`localhost`.

The Docker setup documents and runs the existing API only; it does not change any
API behavior. The automated test suite (`npm test`) continues to use its own
isolated local test database and is unaffected by Docker.

## Verification Status

The implemented backend has been verified end-to-end using **standalone HTTP
verification scripts** (a formal automated test suite has **not** been added yet
— these are not Jest/Supertest tests).

| Area | Assertions | Result |
|------|-----------:|--------|
| Authentication | 21 | ✅ 0 failures |
| Centres / Tests | 21 | ✅ 0 failures |
| Bookings | 22 | ✅ 0 failures |
| Mock Payments | 23 | ✅ 0 failures |
| Webhook | 34 | ✅ 0 failures |
| **Total (regression)** | **121** | **✅ 0 failures** |

For the webhook specifically, the following were explicitly tested:

- Duplicate delivery of the same `eventId` (idempotent `200`, no duplicate payment).
- Concurrent duplicate delivery (exactly one payment; one "processed", one
  "already processed").
- Transaction rollback (a forced failure left no `WebhookEvent`, no partial
  payment, and the booking still `PENDING`).

## Design Decisions

- **Identity from JWT, not the body** — `userId` is always taken from the
  verified token, so a client cannot create or pay for resources on another
  user's behalf.
- **Amount from the database** — booking/payment amounts are read from the
  stored `test.price` / `booking.amount`, so a client can never dictate the
  price it pays.
- **`Decimal` for money** — monetary values use `Decimal(10,2)` to avoid
  floating-point rounding errors.
- **Payment separate from Booking** — payments have their own lifecycle,
  transaction id, and history; a `Booking` can exist (`PENDING`) before any
  payment, and the 1:1 link is enforced by a unique `bookingId`.
- **`WebhookEvent` table** — records processed event ids so duplicate
  provider deliveries are detected and ignored (idempotency).
- **Unique constraints + transactions** — unique constraints (`email`,
  `bookingId`, `eventId`) enforce invariants at the database level, while Prisma
  transactions keep multi-step operations (payment + booking, webhook + payment
  + booking) atomic and consistent, even under concurrency.

## Assumptions

- The payment gateway is **simulated** — there is no real payment provider.
- The webhook is a **simulated** provider callback.
- There is **no** real payment-gateway integration.
- There is **no** real webhook signature verification (no signing secret is
  provided by the assignment).
- The webhook endpoint has **no** JWT authentication by design (it is a
  server-to-server callback, protected by validation + idempotency).

## Future Improvements

Not implemented yet (potential next steps):

- Automated test suite (Jest / Supertest).
- API documentation (Swagger / OpenAPI).
- Containerization (Docker / Docker Compose).
- Real payment-gateway integration with webhook signature verification.
- Operational hardening (rate limiting, Redis, structured logging, pagination).
- Admin roles / role-based access control.
