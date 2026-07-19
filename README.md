# Innospace Scheduler

A self-service scheduler for booking Innospace Tirana's **meeting booths**. Members
sign in, pick a booth and a time range, and the booking is held the moment they
submit (with server-side double-booking prevention). An admin manages members and
every reservation from a dashboard.

Built with Next.js 15 (App Router), React 19, TypeScript, and SQLite
(`better-sqlite3`), with transactional email through Resend and a one-command
deploy to Fly.io.

## Features

- **Arbitrary time ranges**, not fixed slots. A booking is a start and end
  datetime; times snap to a configurable step (default 5 min) with a configurable
  minimum length (default 15 min), inside the open hours.
- **No double-booking.** Overlaps are rejected atomically inside a DB transaction,
  so two people racing for the same slot cannot both win. Ranges are half-open, so
  10:00-11:00 and 11:00-12:00 do not clash.
- **Approval for long bookings.** Anything longer than `AUTO_APPROVE_MAX_HOURS`
  is created as `pending` (which still holds the slot) and must be approved by the
  admin; a note is required at or over that length.
- **Invite-only members.** The admin enters an email; the member sets their own
  name and password from a tokenised activation link.
- **Transactional email** (Resend): invitations, booking confirmations,
  pending-request notices, and cancellations.
- **Admin dashboard** to approve, cancel, or delete reservations and to invite or
  remove members.
- **Typed time picker** built on Tailwind CSS and shadcn/ui: type the digits,
  arrow up/down to step, arrow left/right to move between fields.
- Optional **Cloudflare Turnstile** bot protection, feature-flagged by its secret.

## How booking works

- A booking is stored as `startsAt` / `endsAt` local wall-clock strings
  (`"YYYY-MM-DDTHH:MM"`). Set `TZ` so the server agrees with the space.
- Members book from today up to `BOOKING_WINDOW_DAYS` ahead. Times already passed
  are not offered.
- `ACTIVE_STATUSES` = `confirmed` + `pending`: a pending booking holds the slot
  exactly like a confirmed one. Cancelled and deleted bookings free it.
- The picker only collects the two times. Opening hours, the step grid, the
  minimum length, and clashes are enforced by the booking form and, definitively,
  by the API route and the database.

## Roles

- **Members** are invited by the admin (by email), then activate their account
  from a tokenised link (valid for `INVITE_TTL_DAYS`) where they set their name and
  password. They sign in at `/login`, book booths, and see or cancel their own
  bookings.
- **Admin** signs in with the env `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`, sees
  every reservation, approves or cancels (emailing the member) or deletes, and
  manages members from the **Users** page.

## Tech stack

| Component | Notes |
| --- | --- |
| Next.js 15 (App Router) | `output: "standalone"`, React strict mode |
| React 19 + TypeScript (strict) | |
| better-sqlite3 | Synchronous SQLite, WAL mode, one file on a volume |
| Tailwind CSS + shadcn/ui | The time picker only; the rest is hand-written CSS |
| Resend | Transactional email |
| Fly.io + Cloudflare | SQLite on a Fly volume; Cloudflare in front |

## Getting started

```bash
make setup                # creates .env from .env.example, installs deps
# then fill in .env (see Configuration)
make dev                  # http://localhost:4001
```

Sign in at `/login` as the admin (the `DASHBOARD_*` values), open **Users** to
invite a member, then activate that member and book.

Without `RESEND_API_KEY` set, emails are skipped, so locally the invitation is not
delivered: grab the activation link from the server logs (or the token in the DB)
to complete a member's setup.

`make help` lists convenience targets (`make dev`, `make check`, `make docker-up`).

## Configuration

Copy `.env.example` to `.env`. It documents every variable; the ones you must set
for anything beyond local dev:

| Var | Purpose |
| --- | --- |
| `AUTH_SECRET` | Signs login session cookies. Use a long random string. |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | Admin login. Change the defaults. |
| `RESEND_API_KEY` / `EMAIL_FROM` | Sending email (skipped if the key is unset). |
| `APP_BASE_URL` / `EMAIL_LOGO_URL` | Links and logo in emails. Must be publicly reachable. |
| `TZ` | Timezone for the day boundary (e.g. `Europe/Tirane`). |
| `DATA_FILE` | SQLite path (default `./data/scheduler.db`). |

Scheduling knobs (all optional, with sensible defaults): `OPEN_HOUR`,
`CLOSE_HOUR`, `TIME_STEP_MINUTES`, `MIN_BOOKING_MINUTES`, `BOOKING_WINDOW_DAYS`,
`AUTO_APPROVE_MAX_HOURS`, `INVITE_TTL_DAYS`. Booths come from `SCHEDULER_BOOTHS`
(`id:Name:capacity`, comma-separated); omit it for the built-in defaults.

Secrets live only in `.env` (gitignored) locally and in `fly secrets` in
production. They are never committed.

## Deploy (Fly.io)

`fly.toml` targets the `innospace-scheduler` app in region `fra`, with a 1 GB
volume (`scheduler_data`) mounted at `/app/data` for the SQLite file. Non-secret
config lives in `fly.toml`; secrets are set separately:

```bash
fly secrets set AUTH_SECRET=... DASHBOARD_PASSWORD=... RESEND_API_KEY=...
fly deploy
```

Pushing to `master` also deploys via GitHub Actions, which needs a `FLY_API_TOKEN`
repository secret.

The SQLite schema is created on first run. There are no migrations: a schema
change means rebuilding the table or clearing the DB file.

## Project layout

```
src/lib/           booths, schedule window, types, db (reservations + users),
                   auth (roles + scrypt), email, templates, turnstile, cors
src/app/           / (member booking), /login, /dashboard and /users (admin),
                   /activate (member setup), /api/{login,availability,
                   reservations,users,activate}
src/components/ui/ shadcn Input + the typed time-picker field
tests/             unit / integration / functional (Vitest)
```

## Testing

Unit, integration, and functional tests run on [Vitest](https://vitest.dev):

```bash
make test            # run the suite once
make test-watch      # watch mode
make coverage        # V8 coverage report
```

- **Unit** cover the pure logic (schedule/time rules, auth tokens + scrypt,
  templates, booths, the time-picker helpers, cors/turnstile).
- **Integration** exercise `db.ts` against a throwaway SQLite file per test
  (overlap atomicity, the member lifecycle).
- **Functional** drive each API route handler end to end (validation, status
  codes, auth scoping, cookies), with email and the clock stubbed.

Tests never touch your dev database or send real email. They live in `tests/`
and are type-checked on their own (`tsconfig.tests.json`), so they stay out of
`next build`.

## Scripts

`npm run dev` (port 4001) - `npm run lint` - `npm run typecheck` -
`npm run test` - `npm run format` - `npm run build` / `npm run start`
(production).

`make check` runs the whole gate (format, lint, types, and the test suite);
`make fmt` auto-fixes formatting and lint.
