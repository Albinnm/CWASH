# CWASH payments and memberships

The integration is implemented but disabled until you configure your own Stripe account. No live charges, Stripe products, prices, webhook destinations, or subscriptions have been created by this project. Use a separate sandbox/test database before enabling live payments.

## What customers can do

Signed-in customers can pay the full stored price of a confirmed extra-service booking using Stripe Checkout. Pending requests cannot be paid. Guest bookings retain the original flow; they are not automatically linked to an account for payment. Card details stay with Stripe.

A membership renews monthly and includes one introductory full detail when the customer first joins, followed by maintenance visits at least seven New York calendar days apart. The first maintenance visit must be at least seven days after the introductory detail. Included visits must be requested within the currently paid period and still require owner approval. Pending, confirmed, and completed requests reserve the allowance; cancelled requests release it. Cancelling/rejoining a membership never creates another introductory detail after it has been used. Test and live allowances are separate.

Included visits show a zero balance and cannot be charged through the extra-service payment endpoint. Extra detailing uses the normal service prices. Maintenance is currently scheduled for 60 minutes plus the configured vehicle time adjustment; confirm this operational assumption before launch. All vehicle sizes are covered at the same membership price in this version. The app has no saved vehicle registration/VIN enforcement, so owners must enforce any one-car membership terms manually until that feature is added.

The monthly price has deliberately not been chosen. Set it in Stripe only after deciding your labor/travel budget and terms. Weekly visits are scheduled individually; membership purchase does not automatically schedule a recurring appointment. Future billing periods become bookable after the renewal is paid. Automatic payment failure notifications and receipts can be configured in Stripe; CWASH itself does not send emails.

## Configure a sandbox first

1. Create or open your Stripe account and select a sandbox/test environment.
2. Create one product and a fixed, positive **USD monthly recurring price**, billed once each month with quantity 1. Do not enable trials, usage billing, coupons, plan changes, or quantity changes for this initial integration. Tax calculation is not implemented: confirm your tax obligations and pricing setup before live use.
3. Put these values in the backend's private `.env` file locally or private hosting settings:

   ```dotenv
   STRIPE_SECRET_KEY=your_test_secret_key
   STRIPE_WEBHOOK_SECRET=your_test_endpoint_signing_secret
   STRIPE_MEMBERSHIP_PRICE_ID=your_test_monthly_price_id
   CWASH_PUBLIC_ORIGIN=https://your-actual-cwash-host
   CWASH_ENABLE_LIVE_PAYMENTS=false
   ```

   `CWASH_PUBLIC_ORIGIN` must be the exact website origin without a path. Local sandbox development also accepts `http://localhost:3000` or `http://127.0.0.1:3000`. A phone checkout needs a reachable hosted HTTPS return address. Never put these secrets in GitHub, chat, or `EXPO_PUBLIC_*` variables. This hosted-checkout integration does not require a publishable key in the client.
4. Configure a Stripe webhook destination at `https://your-actual-cwash-host/api/billing/webhook`. Use the standard snapshot event format compatible with the installed Stripe SDK (currently API version `2026-10-28.endive`). Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, and `charge.refunded`. Copy that destination's signing secret into the private setting above.
5. For local testing, the Stripe CLI can forward events: `stripe listen --forward-to localhost:3000/api/billing/webhook`. Use the signing secret printed by this listener while testing locally. The CLI must be installed and signed in separately.
6. Enable Stripe's customer portal for payment-method updates, invoice access, and cancellation at the end of the billing period. Disable product/price switching and subscription quantity changes. CWASH's **Manage billing** button opens this portal for the signed-in customer.
7. Restart the server. Open **Account → Membership & billing** on the website or **Account → Membership & billing** in the mobile app. The admin dashboard has **Payments & memberships**. Mobile payment links open Stripe in the browser; return to CWASH and refresh afterward. Redirects never mark a payment as successful; verified Stripe notifications update the database.

Keep the backend and its SQLite data on a persistent disk, run one server instance, and make tested backups. The service verifies webhook signatures, payment ownership, amount, currency, and environment. Checkout retries reuse the existing session. An ambiguous creation attempt older than the Stripe idempotency retention window requires manual reconciliation rather than risking a duplicate charge.

## Test before enabling live payments

- Create a customer, request a standard booking, confirm it as admin, and pay using Stripe's documented sandbox test card. Check the webhook succeeds and the same booking shows paid on web, mobile, and admin. Refreshing or double-clicking must not create another charge.
- Subscribe in the sandbox. Verify benefits only become available after verified payment. Request the introductory detail, try requesting it twice, then request maintenance a week later. Try dates outside the paid period and an unpaid renewal; those must not grant free visits.
- Test membership renewal, failed payments, cancellation at period end, refund events, browser cancellation, network failure, and a second customer's account. A changed or refunded payment must not be restored by an older webhook delivery.
- Cancel a standard booking with an open checkout and verify that checkout expires. If Stripe is processing payment, cancellation is blocked until the payment notification is reconciled.
- Issue test refunds in Stripe Dashboard. Cancelling a reservation is separate from refunding money. Paid booking cancellations retain their payment record; CWASH does not automatically issue refunds. Refunding any portion of the current membership payment blocks new included requests until billing is reconciled. Review and cancel/reschedule any previously confirmed included visits separately; Stripe events do not automatically remove existing appointments.
- Reconcile unresolved Stripe events before handling the related appointment. Review Stripe's delivery logs and retry failed webhooks. Customer and admin billing statuses reflect the last successfully processed event, not a continuous live query of every payment.

Automated tests use mocked Stripe API responses with real Stripe webhook-signature validation. They are not a substitute for running the complete sandbox flow against your own Stripe account and testing on physical phones.

## Going live later

Complete Stripe business verification, choose the final monthly price and membership/cancellation/refund terms, review vehicle eligibility and taxes, and complete the sandbox checks. Create the matching live product, price, webhook, and portal configuration. Use a separate live database, live credentials, the live price ID, HTTPS origin, and `CWASH_ENABLE_LIVE_PAYMENTS=true`. Rotate/restrict keys as appropriate. Test data and test memberships do not become real subscriptions. No live setup or charge is authorized simply by deploying the repository.
