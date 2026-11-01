# Open CWASH on your iPhone without a computer

The target is a signed CWASH app installed through **TestFlight**, connected to an always-online backend. After the one-time setup, open CWASH from your home screen using Wi-Fi or cellular data. Your computer, PowerShell, and Expo Go do not need to run.

**Current state:** the code and deployment files are prepared. No server is deployed, no signed iPhone installer exists, and no store submission has been made. The account owner must complete Apple enrollment and approve hosting/build costs. Do not share passwords, verification codes, signing keys, or API tokens in chat.

## 1. Enroll with Apple

Visit [Apple Developer enrollment](https://developer.apple.com/programs/enroll/) and enroll with your own Apple Account. Apple displays the membership fee and requirements for your region. Wait for your membership to become active before starting the iPhone build.

You can install **TestFlight** from the iPhone App Store now. Installing TestFlight alone does not install CWASH; the signed CWASH build will appear later.

## 2. Put the backend online

The supplied `render.yaml` prepares one Render web service plus a persistent disk for bookings. This uses a **paid Starter service and a paid 1 GB disk**; review the prices Render displays before approving deployment. The persistent disk is required—an ephemeral/free filesystem would lose your reservations and customer/admin accounts.

1. Create or sign in to your [Render account](https://dashboard.render.com/), connect GitHub, and create a **Blueprint** from `Albinnm/CWASH`, branch `main`. Render will read `render.yaml`. Review its validation and plan details; the cloud workspace has not validated this against Render's live provisioning API.
2. When prompted, enter `CWASH_INITIAL_ADMIN_EMAIL` and choose `CWASH_INITIAL_ADMIN_PASSWORD` (at least 12 characters) in Render's private environment settings. These create your hosted admin account once. Existing local accounts/bookings are not uploaded. No admin password is committed to GitHub.
3. Approve deployment when ready. Wait for the service to become healthy and copy its HTTPS URL from Render. Open that URL with `/admin` appended and sign in. After verifying login, remove the two initial-admin variables from Render. Restarting preserves the stored account; these variables never reset an existing password.
4. Review sample prices and available hours. Keep preview mode enabled during testing. Render provides the public origin automatically; if you use a custom domain later, set `CWASH_PUBLIC_ORIGIN` to that exact HTTPS origin.

The database lives on `/var/data/cwash`, outside the website files. Use a single service instance for this SQLite app. The blueprint assumes one trusted reverse-proxy hop; verify the actual deployment topology before customer launch. Ensure different clients are not sharing one proxy-IP rate-limit bucket. Set up and verify backups in your hosting account. Deployments are manual by default.

To check the live backend from the project folder:

```powershell
npm.cmd run hosted:check -- https://YOUR-ACTUAL-SERVICE.onrender.com
```

This read-only check verifies API health, the catalog, and presence of an admin account. Replace the example URL. A successful local test is not proof that your hosted service has been deployed.

## 3. Build and install CWASH once

Use the `mobile` directory on your computer for this one-time setup. EAS builds happen in Expo's cloud; you do not need a Mac. Your Apple membership must already be active.

1. Pull the current project and run `npm.cmd ci` in `mobile` if needed. Sign in to Expo as `albinm2004`. If Windows browser opening fails, run `$env:BROWSER="none"` followed by `npx.cmd expo login`, then manually open the **new** link in Chrome and complete Google sign-in while PowerShell stays open.
2. Run `npx.cmd eas-cli@27.2.0 init` and link/create the CWASH project under your own Expo account. This writes the actual project ID; do not invent one. Review the suggested `com.cwash.mobile` bundle identifier before the first Apple build and choose an identifier you control if it is unavailable.
3. In that Expo project's **production environment**, add `EXPO_PUBLIC_API_URL` with the exact deployed HTTPS backend URL from step 2. This address is public, not a secret. Do not use a computer's LAN IP or localhost. Remove or update the old local `EXPO_PUBLIC_API_URL` line in `mobile/.env` so local build preparation cannot use a conflicting address.
4. In PowerShell, from `mobile`, run:
   ```powershell
   npm.cmd run iphone:build
   ```
   This explicitly starts a cloud build and submits it to App Store Connect. Review any Expo build charges and Apple credential prompts. Sign in using your own Apple Account when asked. Let EAS guide you through signing and App Store Connect setup. This command is provided, **not already executed**.
5. After Apple processes the upload, open App Store Connect → your CWASH app → **TestFlight**. Complete requested beta/compliance details, add yourself as an internal tester, and accept the invitation on your iPhone. In TestFlight, tap **Install** for CWASH.
6. In CWASH's **Account** tab, create a customer account or sign in with one created at the hosted website's `/account` page. Turn off your computer and test a reservation over cellular data. Confirm it from the hosted `/admin` dashboard, then refresh **My bookings** in CWASH. Check that the same reservation appears on the website when signed in with that customer account. This is the acceptance check for independent phone access. Earlier guest bookings are not automatically linked to customer accounts.

TestFlight builds expire after 90 days and need replacement builds. External testers may require beta review. Public App Store distribution is the eventual long-term route and requires App Review, real app icons (template icons are still present), privacy/support information, and store listing details. Customer signup, profile editing, and password changes are implemented; changing a password signs out all of that customer's sessions. Email verification, forgotten-password recovery, and in-app account deletion remain outstanding before public launch/App Store submission. Payments and push notifications remain unimplemented.

## What was verified in the development environment

Local tests cover first-run account creation, preserving account passwords across restarts, allowed browser origins, proxy configuration, booking access, and existing reservation behavior. The iPhone build profile is checked against EAS's installed schema. No Apple login, signing, paid deployment, TestFlight processing, or physical-iPhone validation is claimed.
