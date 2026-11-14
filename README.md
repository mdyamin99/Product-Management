# Product Management

A product catalogue API and dashboard built to exercise a realistic
distributed stack: **PostgreSQL + Prisma**, **Redis** caching, **Kafka** and
**RabbitMQ** event streaming, **OpenTelemetry** tracing/metrics, and a
**React + Tailwind** frontend.

```
backend/     Express 5 + Prisma API (TypeScript, ESM)
frontend/    React 19 + Vite + Tailwind 4
compose.yaml  Postgres, Redis, Kafka, RabbitMQ, Mailpit, Jaeger, Prometheus, Grafana
observability/  OTel collector + Prometheus/Grafana provisioning
loadtest/    k6 scenarios
```

## Quick start

```bash
# Infrastructure (Postgres, Redis, Kafka, RabbitMQ, Mailpit, observability)
docker compose up -d postgres redis kafka rabbitmq mailpit

# Apply database migrations
cd backend && npx prisma migrate deploy

# API            -> http://localhost:3000
npm run dev

# Dashboard      -> http://localhost:5173   (in a second terminal, frontend/)
npm run dev
```

Or bring the whole stack up at once with `docker compose up --build`.

| Service    | URL                            |
| ---------- | ------------------------------ |
| API        | http://localhost:3000          |
| Dashboard  | http://localhost:5173          |
| Mailpit UI | http://localhost:8025          |
| Kafka UI   | http://localhost:8080          |
| RabbitMQ   | http://localhost:15672         |
| Jaeger     | http://localhost:16686         |
| Grafana    | http://localhost:3001          |

## Authentication

### Routes

| Method | Path                        | Notes                                    |
| ------ | --------------------------- | ---------------------------------------- |
| POST   | `/api/auth/register`        | Creates the account and signs you in     |
| POST   | `/api/auth/login`           | Publishes a `user.loggedin` event        |
| POST   | `/api/auth/refresh`         | Rotates the refresh cookie, new access token |
| POST   | `/api/auth/logout`          | Revokes the session, clears the cookie   |
| GET    | `/api/auth/me`              | Requires `Authorization: Bearer <token>` |
| POST   | `/api/auth/forgot-password` | Always 200, e-mails a 6-digit code, never reveals whether the address exists |
| POST   | `/api/auth/reset-password`  | Consumes the code, revokes all sessions  |

### Token model

- **Access token** — 15-minute JWT returned in the response body and held in
  memory on the client. Sent as `Authorization: Bearer …`.
- **Refresh token** — 7-day JWT delivered **only** as an `httpOnly`,
  `SameSite=Lax` cookie scoped to `Path=/api/auth`, so JavaScript (and
  therefore XSS) cannot read it and it is never attached to ordinary API
  calls.

Refresh tokens are **rotated on every use** and stored in Postgres as a
SHA-256 hash. Each sign-in creates a *family* (one per device session):

- Presenting a rotated token again is treated as theft and revokes the whole
  family — unless it arrives within a **30-second grace window**, which is
  what lets two browser tabs refresh concurrently without logging each other
  out.
- Changing a password revokes every outstanding session.

### Messaging flow

A sign-in publishes an event that fans out before any e-mail is written:

```
POST /api/auth/login
   └─> Kafka  topic "auth.events"
          └─> forwarder (manual offset commit)
                 └─> RabbitMQ  exchange "auth.events"  binding "user.#"
                        └─> queue "auth.notifications"
                               └─> Nodemailer  ->  welcome-back e-mail
```

`user.registered` follows the same path on signup. If Kafka is unavailable
the notification is delivered directly instead, and if RabbitMQ is down the
Kafka forwarder delivers it — a welcome message is never silently dropped.

Product events use a parallel topology (`product.events` topic/exchange,
`product.notifications` queue):

```
POST /api/products[/:id]   (create / update / delete / fetch)
   └─> Kafka  topic "product.events"
          └─> forwarder (manual offset commit)
                 └─> RabbitMQ  exchange "product.events"  binding "product.#"
                        └─> queue "product.notifications"
                               └─> Redis activity feed
                                      └─> GET /api/products/activity
                                             └─> dashboard "Activity" tab
```

Every product operation — including **reads** — publishes a
`product.created` / `product.updated` / `product.deleted` /
`product.fetched` event, so the whole pipeline is observable from the
dashboard's Activity tab (per-type counters plus a rolling list of the last
50 consumed events). The RabbitMQ consumer performs the real work of writing
that feed; offsets are committed after the forward attempt so no event is
lost on a crash.

Both brokers recover on their own: RabbitMQ re-registers every consumer on
each reconnect, and Kafka retries the initial connection in the background
(consumers start through `onKafkaReady` whenever it succeeds).

### E-mail

[Nodemailer](https://nodemailer.com) sends three templated messages: welcome,
welcome-back, and a **6-digit password-reset code** (the code is stored only
as a peppered HMAC, caps at 5 wrong attempts and expires after 30 minutes).

Configuration is read from `backend/.env` for local runs and from the `.env`
next to `compose.yaml` for the Docker stack:

- `SMTP_HOST` **unset** (the default in `backend/.env.example`): messages are
  printed to the console, so the flow works on a fresh clone with no mail
  server.
- `SMTP_HOST=localhost` / `mailpit` (the compose default): messages land in
  the Mailpit UI at http://localhost:8025.
- **Gmail:** set `SMTP_HOST=smtp.gmail.com` plus `SMTP_USER` and `SMTP_PASS`
  (an [App Password](https://myaccount.google.com/apppasswords) — 2-Step
  Verification must be on). For Docker, edit the `.env` next to
  `compose.yaml` and run `docker compose up -d backend`.

### Security details

- Passwords hashed with bcrypt (cost 12); login runs a dummy comparison when
  the address is unknown so response timing does not leak which accounts exist.
- Zod validation on every body, with field-level errors returned to the form.
- Per-IP fixed-window rate limits on login (10/5 min), register (5/5 min),
  refresh (30/min) and the reset endpoints, backed by Redis with an
  in-process fallback.
- Password-reset codes are 6 digits, expire in 30 minutes, are stored as an
  HMAC peppered with `PASSWORD_RESET_PEPPER` (falling back to the refresh
  secret) and are burned after 5 wrong attempts.
- Generic error messages for bad credentials and unknown addresses.
- `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` and
  `Cross-Origin-Opener-Policy` headers on every response.
- CORS is restricted to `FRONTEND_URL` with `credentials: true`.

## Environment variables

All settings are validated by Zod at startup (`backend/src/config/env.ts`);
a missing or malformed value prints exactly which key is wrong and exits.
See `backend/.env.example` for the full annotated list.

The frontend has a single setting, `VITE_API_URL` (see
`frontend/.env.example`), which is inlined into the bundle at build time.

The two secrets that matter most:

```bash
JWT_ACCESS_SECRET=...    # 32+ characters
JWT_REFRESH_SECRET=...   # 32+ characters, and different from the above
```

## Testing

```bash
cd backend && npm run typecheck   # tsc --noEmit
cd frontend && npm run build      # tsc -b && vite build
cd frontend && npm run lint       # eslint
```
