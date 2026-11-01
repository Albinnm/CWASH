# CWASH

Mobile car detailing reservations for New York City, with customer accounts on the website and native app, and a protected owner dashboard.

The native iPhone/Android application is in [`mobile/`](mobile/README.md). It uses React Native screens and connects to this backend. Read the mobile guide for Expo Go device testing and signed standalone builds. The native app is not yet published to either app store.

**Want to open CWASH on your iPhone without running your computer?** Follow the [independent iPhone setup guide](docs/IPHONE-SETUP.md). The hosted backend blueprint and TestFlight build command are ready for account setup; no hosted service or signed build exists yet.

## Start on your computer

Install **Node.js 24 LTS** (includes npm). In a terminal inside this project, run:

```sh
npm ci
npm run admin:create
npm run dev
```

The admin command asks for your email and a password of at least 12 characters. Password entry is hidden. Choose your own credentials; there is no default admin account. This creates an account in the local database. It does not register an email with any external service.

The server prints its address (port 3000 by default). Open that address in your browser for the customer website, `/account` to create a customer account, or `/admin` for the owner dashboard. Customer and admin accounts are separate. Keep the terminal running. Development mode uses Vite; refresh the page after edits.

For a production build:

```sh
npm run build
npm start
```

Optional settings can be copied from `.env.example` into `.env`. The app loads `.env` automatically. Use the existing checkout in this isolated cloud environment; no Git worktree is required.

## What works

- Three service packages, vehicle-dependent estimates, ZIP coverage checks, parking/access notes, and guest reservations.
- Customer email/password signup and sign-in at `/account` or the native app's **Account** tab. Customers can update their name/phone, change their password, and see bookings made while signed in. Passwords require at least 12 characters; changing one signs out all of that customer's sessions.
- Shared customer booking history across the website and native app when both use the same backend. Contact details fill automatically when booking; earlier guest bookings are not automatically linked by email.
- Four-step booking with availability in **America/New_York**, including daylight-saving changes. Requests open up to 90 days ahead, with configurable advance notice.
- Requests start **pending**. An owner reviews access and confirms the appointment. Pending requests do not hold slots; confirmed appointments reserve the full service duration plus travel time. Conflicting confirmations and reschedules are rejected.
- Admin login, appointment search and filters, day/week calendar, confirmations, rescheduling, cancellation, and completion.
- Admin editing of service prices/durations, working days/hours, days off, coverage prefixes, travel buffer, and advance notice. Estimates already stored on bookings stay unchanged when prices change.
- SQLite persistence, password hashing, seven-day customer sessions and eight-hour admin sessions, server-side validation, and booking/login rate limits. Web sessions use HttpOnly cookies and CSRF protection; the native app keeps its customer session token in OS-protected SecureStore.

## First business setup

Sign in to `/admin`, open **Business settings**, and replace sample prices and availability with your real terms. The default coverage prefixes cover the five NYC boroughs broadly; this is not address verification. Review parking, exact location, water/power requirements, and travel feasibility manually before accepting a request. The single calendar assumes one detailing crew. Route optimization is not included.

Leave the customer preview notice enabled until your prices and operating details are ready. Vehicle surcharges are currently configured in `server/store.js` ($0 sedan, $30 SUV, $50 large vehicle). Disable the preview notice in Business settings when ready.

Booking references appear on the customer confirmation screen and signed-in customers can refresh their booking history for status updates. **No email, SMS, or payment is sent or processed.** Contact customers directly to confirm or change bookings. Email verification, forgotten-password recovery, email changes, account deletion, self-service cancellation, payments, reminders, and staff assignment are not implemented.

## Data and deployment

The database is stored in ignored `data/cwash.sqlite` by default, or the folder selected by `CWASH_DATA_DIR`. Customer/admin accounts, bookings, settings, and sessions persist there. Startup automatically adds the customer, customer-session, and booking-ownership tables to existing databases, preserving existing data; no reset or manual migration is needed. Keep the folder private and back it up with a SQLite-aware backup or while the server is stopped. Do not commit customer data or `.env`.

This is a working development MVP; it is not publicly deployed. Before accepting real customer data, deploy behind HTTPS, set `COOKIE_SECURE=true`, configure a persistent private database volume and backups, set your privacy/cancellation terms, and review your NYC operating requirements. Complete email verification, password recovery, and account deletion before public account launch or App Store submission. Use a single app instance for this SQLite/single-crew version. Proxy trust defaults to zero; set `CWASH_TRUST_PROXY_HOPS` only for the verified proxy topology. `CWASH_PUBLIC_ORIGIN` (or Render's `RENDER_EXTERNAL_URL`) controls the exact permitted browser origin. The supplied Render blueprint assumes one proxy hop and must be checked on the real deployment.

Optional `CWASH_INITIAL_ADMIN_EMAIL` and `CWASH_INITIAL_ADMIN_PASSWORD` host settings create the first admin on an empty database. They never change an existing account. Enter them privately in hosting settings, verify login, then remove both variables. Existing local databases are not uploaded automatically.

## Checks

```sh
npm test
npm run build
```

The API tests use temporary databases and exercise booking validation, server-side pricing, customer/admin authentication, customer booking ownership, CSRF, password changes, persistence, confirmation conflicts, travel buffers, rescheduling, and settings. They do not write to your real customer database.

Browser checks are available with `npm run test:e2e`. Install a browser once using `npx playwright install chromium`, or set `CWASH_BROWSER_PATH` to a compatible installed Chromium executable. Browser tests use a separate in-memory database and test-only credentials, covering guest/admin flows and customer signup, booking history, profile/password changes, and account isolation.

## Project layout

- `src/App.jsx`, `src/customer.css`: customer website and reservation flow.
- `src/CustomerAccount.jsx`, `src/customer-auth.jsx`: customer account screens and web sessions.
- `src/Admin.jsx`, `src/admin.css`: owner dashboard.
- `server/app.js`: API, authentication, validation, and admin actions.
- `server/customers.js`: customer authentication, profile/password changes, and owned bookings.
- `server/store.js`: SQLite storage and default service catalog.
- `server/scheduling.js`: New York scheduling and conflict checks.
