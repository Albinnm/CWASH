# CWASH for iPhone and Android

This is a native React Native application built with Expo SDK 58 and Expo Router. It renders native controls; it does not open the website in a WebView. The website and owner dashboard remain in the repository root.

For an installed iPhone app that works without your computer, use the [hosted backend and TestFlight guide](../docs/IPHONE-SETUP.md). The local Expo Go steps below are only for development. The `iphone:build` command creates and submits a signed build after your Apple, Expo, and hosting accounts are configured; it has not been run yet.

## Included

- Native Discover, Book a detail, My bookings, and Account tabs.
- Services and vehicle estimates loaded from the existing API.
- NYC address/parking fields, available dates and times, contact details, and booking receipt.
- Customer email/password signup and sign-in in **Account**, editable name/phone, and password changes. Passwords require at least 12 characters; changing one revokes every session for that customer. Customer sessions last seven days and their tokens are kept in OS-protected SecureStore; admin accounts remain separate and have eight-hour sessions.
- Account bookings shared with the website when both connect to the same backend. Sign in before booking to save a request to the account and fill contact details automatically. Pull down in **My bookings** for the latest status after admin confirmation, cancellation, or rescheduling.
- Guest checkout remains available. Guest receipts and private per-booking access keys are stored in SecureStore on that phone; knowing a reference alone does not allow someone to read a booking. Guest history stays separate and is not automatically linked to an account by matching email.
- Email verification, forgotten-password recovery, email changes, account deletion, push notifications, payments, and self-service cancellation are not implemented.

## Test on your phone from Windows

1. In `C:\Users\albinm\CWASH`, pull the latest code and run `npm.cmd ci`.
2. Start the backend in that folder:
   ```powershell
   $env:HOST="0.0.0.0"
   npm.cmd run dev
   ```
3. Open another PowerShell window. Run `ipconfig` and find your computer's Wi-Fi IPv4 address. Both devices must be on the same Wi-Fi; allow Node.js on private networks if Windows prompts.
4. In the second window:
   ```powershell
   cd C:\Users\albinm\CWASH\mobile
   npm.cmd ci
   Copy-Item .env.example .env
   notepad .env
   ```
   Replace the example IP with your computer's actual address. For example, `EXPO_PUBLIC_API_URL=http://192.168.1.25:3000`. This is a public server address, never a secret. Do not use localhost: on a phone, that refers to the phone itself.
5. Install **Expo Go** from your phone's app store. Run `npm.cmd start` in the `mobile` folder and scan the terminal QR code (Camera on iPhone, Expo Go on Android). Expo Go must support SDK 58; update it if prompted. This loads the native app inside Expo's development client for testing. Keep both terminal windows open. After changing `.env`, restart Expo with `npm.cmd start -- --clear`.
6. Open **Account** and create a customer account, or sign in with one created on the website's `/account` page on this same backend. Submit a test request, confirm it from the web admin dashboard, then pull down in **My bookings** to see the updated status. Automatic notifications are not enabled. You can also continue as a guest.

An Expo Go session is a development test. A signed standalone CWASH installation is a separate build below. No simulator or physical-device run was performed in the cloud workspace; run these steps to verify device behavior.

## Standalone installs and stores

The checked-in `eas.json` supports an internal Android APK and production store builds. Actual signing/build/upload requires your Expo account, and Apple/Google accounts for their stores. No signing or store submission has been performed.

First deploy the root backend to a persistent HTTPS service, set the actual public server address as `EXPO_PUBLIC_API_URL` in the appropriate EAS build environment, and configure a unique owner-approved iOS bundle ID and Android package in `app.json` (current suggested ID: `com.cwash.mobile`). Configure your Expo/EAS project with `npx.cmd eas-cli@latest init`. The `.env.example` address is only an example. Release builds reject HTTP server URLs. Never embed admin credentials in the app.

```powershell
# Sign in to your own Expo account, then configure your project/build environment.
npx.cmd eas-cli@latest login
npx.cmd eas-cli@latest build --platform android --profile preview
npx.cmd eas-cli@latest build --platform ios --profile production
npx.cmd eas-cli@latest build --platform android --profile production
```

An Android preview build produces an installable APK. iOS distribution uses Apple signing and TestFlight or approved registered devices. EAS builds may use account credits; run them only when ready. Review app icons (currently Expo template assets), real prices, privacy policy, contact details, permissions, and business terms before release, and complete account deletion, email verification, and password recovery. Guest SecureStore receipts may be lost when the app is removed; signed-in bookings persist on the backend and are available after signing in again.

## Validation

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run export
```

`expo export` validates Android/iOS JavaScript bundles; it does not create a signed APK/IPA. Native component tests use mocked network/storage, while root `npm test` exercises the real booking API, private receipt authorization, and customer authentication/booking ownership.

Cloud network settings may not allow Expo documentation/metadata hosts. Installation can use `EXPO_OFFLINE=1 npx expo install ...` with SDK compatibility versions included in the installed Expo package and npm access. Native export works with `EXPO_OFFLINE=1`. Device/EAS workflows need normal Expo connectivity on your computer.
