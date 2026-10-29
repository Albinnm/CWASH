# CWASH

Mobile car detailing reservations for New York City, with a customer website and a protected owner dashboard.

The native iPhone/Android application is in [`mobile/`](mobile/README.md). It uses React Native screens and connects to this backend. Read the mobile guide for Expo Go device testing and signed standalone builds. The native app is not yet published to either app store.

## Start on your computer

Install **Node.js 24 LTS** (includes npm). In a terminal inside this project, run:

```sh
npm ci
npm run admin:create
npm run dev
```

The admin command asks for your email and a password of at least 12 characters. Password entry is hidden. Choose your own credentials; there is no default admin account. This creates an account in the local database. It does not register an email with any external service.

The server prints its address (port 3000 by default). Open that address in your browser for the customer website, and add `/admin` to open the owner dashboard. Keep the terminal running. Development mode uses Vite; refresh the page after edits.

For a production build:

```sh
npm run build
npm start
```

Optional settings can be copied from `.env.example` into `.env`. The app loads `.env` automatically. Use the existing checkout in this isolated cloud environment; no Git worktree is required.

## What works

- Three service packages, vehicle-dependent estimates, ZIP coverage checks, parking/access notes, and guest reservations.
- Four-step booking with availability in **America/New_York**, including daylight-saving changes. Requests open up to 90 days ahead, with configurable advance notice.
- Requests start **pending**. An owner reviews access and confirms the appointment. Pending requests do not hold slots; confirmed appointments reserve the full service duration plus travel time. Conflicting confirmations and reschedules are rejected.
- Admin login, appointment search and filters, day/week calendar, confirmations, rescheduling, cancellation, and completion.
- Admin editing of service prices/durations, working days/hours, days off, coverage prefixes, travel buffer, and advance notice. Estimates already stored on bookings stay unchanged when prices change.
- SQLite persistence, password hashing, eight-hour HttpOnly sessions, CSRF protection, server-side validation, and booking/login rate limits.

## First business setup

Sign in to `/admin`, open **Business settings**, and replace sample prices and availability with your real terms. The default coverage prefixes cover the five NYC boroughs broadly; this is not address verification. Review parking, exact location, water/power requirements, and travel feasibility manually before accepting a request. The single calendar assumes one detailing crew. Route optimization is not included.

Leave the customer preview notice enabled until your prices and operating details are ready. Vehicle surcharges are currently configured in `server/store.js` ($0 sedan, $30 SUV, $50 large vehicle). Disable the preview notice in Business settings when ready.

Booking references appear on the customer confirmation screen. **No email, SMS, or payment is sent or processed.** Contact customers directly to confirm or change bookings. Customer accounts, self-service cancellation, payments, reminders, and staff assignment are future integrations.

## Data and deployment

The database is stored in ignored `data/cwash.sqlite` by default, or the folder selected by `CWASH_DATA_DIR`. Admin accounts, bookings, settings, and sessions persist there. Keep the folder private and back it up with a SQLite-aware backup or while the server is stopped. Do not commit customer data or `.env`.

This is a working development MVP; it is not publicly deployed. Before accepting real customer data, deploy behind HTTPS, set `COOKIE_SECURE=true`, configure a persistent private database volume and backups, set your privacy/cancellation terms, and review your NYC operating requirements. Use a single app instance for this SQLite/single-crew version. Proxy trust is intentionally not enabled; configure the exact trusted proxy topology before public deployment so rate limits use reliable client addresses.

## Checks

```sh
npm test
npm run build
```

The API tests use temporary databases and exercise booking validation, server-side pricing, authentication, CSRF, persistence, confirmation conflicts, travel buffers, rescheduling, and settings. They do not write to your real customer database.

Browser checks are available with `npm run test:e2e`. Install a browser once using `npx playwright install chromium`, or set `CWASH_BROWSER_PATH` to a compatible installed Chromium executable. Browser tests use a separate in-memory database and test-only credentials.

## Project layout

- `src/App.jsx`, `src/customer.css`: customer website and reservation flow.
- `src/Admin.jsx`, `src/admin.css`: owner dashboard.
- `server/app.js`: API, authentication, validation, and admin actions.
- `server/store.js`: SQLite storage and default service catalog.
- `server/scheduling.js`: New York scheduling and conflict checks.
