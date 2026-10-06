# Rent Manager

A mobile rental and room management app for a property owner: properties, rooms, tenants, Aadhaar/PAN documents,
rent, electricity, monthly bills, payments, PDF invoices, dashboard and reports.

- **Mobile**: React Native + Expo (Android first, iOS-ready), Expo Router, NativeWind, TanStack Query, React Hook Form + Zod, Lucide icons
- **Backend**: NestJS + TypeScript, Prisma, PostgreSQL (Supabase), argon2, JWT access + rotating refresh sessions, PDFKit
- **Storage**: private Cloudflare R2 bucket (S3 API). The phone never holds storage credentials.

```
Mobile app ──HTTPS──▶ NestJS API ──▶ Supabase PostgreSQL
                          └───────▶ Cloudflare R2 (private documents)
```

```
apps/mobile      Expo app (app/ routes, components/ui design system, features/, api/, services/, theme/)
apps/web         Website (Vite + React + Tailwind): same features as the phone app, for laptop and phone browsers
apps/backend     NestJS API (auth, properties, rooms, tenants, assignments, documents, billing, payments, reports, dashboard)
packages/shared  Shared enums and response types
prisma/          schema.prisma and SQL migrations (database-level business rules live here)
docs/            Architecture notes
```

Design decisions are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 1. Run it locally

Requirements: Node 20+ (tested on 22), PostgreSQL 14+ (or a Supabase project).

```bash
npm install

# Backend configuration
cp .env.example apps/backend/.env        # edit DATABASE_URL, DIRECT_URL, JWT secrets, R2 keys (see section 2)
                                         # (a .env at the repository root works too)

# Database. Supabase IS the PostgreSQL database: you do not install Postgres yourself.
npm run db:deploy                        # creates/updates the tables in the database your .env points to (use this with Supabase)
                                         # npm run db:migrate is only for developing the schema against a local Postgres
npm run db:seed                          # owner account + demo data (Sunrise Residency, rooms 101-105, 3 tenants, bills, payments)

npm run backend                          # API on http://localhost:3000   (GET /health)

# Mobile
cp apps/mobile/.env.example apps/mobile/.env     # EXPO_PUBLIC_API_URL
npm run mobile                           # Expo dev server; press "a" for an Android emulator
```

Default seeded login: `owner` / `ChangeMe123!` (from `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`). **Change it** under
More > Settings > Profile & Security. `npm run -w @rental/backend prisma:seed:admin` creates only the account, no demo data.

API URL from the app: Android emulator `http://10.0.2.2:3000`, iOS simulator `http://localhost:3000`, physical phone
`http://<your-computer-LAN-IP>:3000`. Production must be `https://`.

Without R2 keys, development falls back to storing documents on local disk (`apps/backend/.storage`, git-ignored) behind the
same signed, expiring links. **Production refuses to start without R2 configured.**

### Electricity rates, bill PDF and dues of tenants who left
- **Rate per unit is set at three levels**, each prefilled from the one above: the property default (Bill Settings), the room (new rooms start at the property default), and the tenant's stay
  (starts at the room's rate; change it any time under Tenant > Electricity > Change, optionally also as the room's default). On *Generate Bill* the rate is shown and editable:
  type another rate for that one bill, or tap *Save as this tenant's rate* to use it from then on. Bills already generated never change.
- **Bill PDF** (default): a designed one-page A4 bill with the amount due, a plain-language breakdown (meter readings, units x rate, what the previous balance is made of),
  payments received, a PAID stamp, and a *Scan to pay* UPI QR with the amount filled in (set your UPI ID under Bill Settings; the QR only appears while something is unpaid).
  `GET /bills/:id/pdf?format=statement` still returns the one-table form from the Excel sheet and `?format=invoice` the plain invoice.
- **Tenants who moved out keep their dues.** Nothing is written off automatically: the balance stays on their old bills. Home shows *Moved out, still owe* and the Total outstanding split
  into current and former tenants; the Tenants tab has *Owes money* and *Left with dues* filters; payments can be recorded against old bills any time (Tenant > Payments > Record Payment).
- **Excel export**: Settings > *Export all data to Excel* (web and phone) downloads one workbook: Summary, Rooms, Tenants (with what each owes), Stays, Bills, Bill items, Payments, Electricity (readings, units, rate), Outstanding (current and former tenants) and Monthly. Every sheet is a filterable table with real numbers and dates. `GET /exports/excel[?propertyId=]`.
- **Electricity history**: on every tenant profile, an *Electricity* tab with the total, monthly average, highest month, current rate, a 12-month chart and each month's readings and amount (months imported from the spreadsheet show the amount only).
- **Home KPIs**: collection of the month with its rent/electricity/other make-up, total outstanding (current vs former), overdue, due in 7 days, rent roll, occupancy and the rent lost to vacancy,
  collected in the last 7 days, tenants still to be billed this month, six-month trend and recent payments.

### Bill period, monthly charges, deposits and agreements
- **Dates follow India time.** "Today", "Issued on", payment and deposit dates use `APP_TIMEZONE` (default `Asia/Kolkata`), not the server clock (UTC on Render).
  A bill's *Issued on* is the India day it was generated (`issuedOn` in the API, from `createdAt`).
- **Bill period** is the billing month as a range, e.g. *01 Aug 2026 – 31 Aug 2026* (`billPeriodStart` / `billPeriodEnd`, computed, no column). Shown on every PDF, the bill screen and the Excel export.
- **Monthly charges**: *Water bill*, *Housekeeping*, *MNGL fuel bill* and *WiFi connection* each get their own line, right after electricity and in that order (one line each per bill).
  They are stored as charge types `WATER`, `CLEANING`, `MNGL_GAS` and `INTERNET` (so older "Cleaning"/"Internet" charges now show as Housekeeping/WiFi). On *Generate Bill* they are prefilled
  from the tenant's recurring charges and can be changed for that bill; blank or 0 leaves the line off. MNGL can carry a short note (units or reading) printed on the bill.
- **Security deposit**: the stay's *agreed* deposit plus every amount actually *received*, with its date (Tenant > Security deposit > Add deposit received, or at move-in).
  Totals (received, pending, last received date) are computed. The deposit is printed on bills for information only and is **never** part of the amount due.
  `GET/POST /room-assignments/:id/deposits`, `DELETE /room-assignments/:id/deposits/:receiptId`.
- **Agreement**: optional start and end dates per stay (Add Tenant, Assign Room, Edit Tenant). A green tick shows while the agreement is valid (the end date included),
  a red cross after the end date, grey before it starts. Shown on tenant cards, the tenant profile, the room screen and the bill screen for current tenants.
- **Payment received date**: every payment row shows the date the money was received; a settled bill shows *Paid in full on …* and a part-paid bill *Last payment ₹… on …* (screen and PDF).
- **Landlord phone** (optional, Bill Settings) is printed under the address on bills.

### Import an existing Excel register (full history)
```bash
npm run db:import -- /path/to/RENT.xlsx --dry-run     # preview: tenants, rooms, dues, anything odd in the sheet
npm run db:import -- /path/to/RENT.xlsx               # import everything
npm run db:import -- /path/to/RENT.xlsx --replace     # delete the previous import (that property only) and import again
```
Reads the **Billing** tab: every month since 2017, every tenant who ever lived there, their stays (room, dates, rent changes) and every monthly bill.
The sheet records what was billed and the unpaid balance carried into the next month, not the payments, so each payment is **derived**:
*paid = month total minus the balance the sheet carries forward*. They are dated the 10th of the next month, method "Other", reference `IMPORTED`.
Bill totals always equal the sheet; where the sheet's own numbers do not add up, the bill shows an explicit *Adjustment as per register* line (the dry run counts them).
Month labels that are out of order are fixed from the block order, a block copied twice counts once, and name suffixes like "- 20" are ignored.

**Tenants who left owing money** keep those dues: a tenant's last month is left unpaid only if the sheet already showed arrears in it, otherwise it is assumed paid.
The latest month (Aug 2026) is billed but unpaid for everyone. Former tenants with dues appear on Home, in Reports > Outstanding and in the Tenants tab, and you can record payments against them as usual.

Not in the sheet, so add them in the app: phone numbers, security deposits and meter readings (type the last reading into **Previous** on the first new bill).
Run it on the machine that holds your `.env` (so it writes to Supabase), and never commit the spreadsheet. Use `--current-only` for just the latest month.

## 2. Accounts you need

### Supabase (PostgreSQL)
1. Create a project. Settings > Database > Connection string.
2. `DATABASE_URL` = the **pooled** string (port 6543, add `?pgbouncer=true&connection_limit=1`), `DIRECT_URL` = the **direct** string (port 5432).
3. Run migrations once from your machine (or CI): `npm run db:deploy`. Both `DATABASE_URL` and `DIRECT_URL` must be in `.env`; if you are not using the pooled URL, set both to the same connection string.
4. `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are reserved for future Supabase features; the app talks to Postgres through Prisma only.
   Keep the service-role key on the server. Do not enable public API access to these tables (the API is the only client).

### Cloudflare R2
1. Create a bucket (for example `rent-documents`) and leave it **private** (no public access, no custom public domain).
2. R2 > Manage API tokens > create a token with *Object Read & Write* scoped to that bucket.
3. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` on the **backend only**.

## 3. Environment variables

| Where | Variable | Purpose |
|---|---|---|
| backend | `DATABASE_URL`, `DIRECT_URL` | Prisma connections (pooled / direct) |
| backend | `JWT_SECRET`, `JWT_REFRESH_SECRET` | Token signing. Use long random values: `openssl rand -base64 48` |
| backend | `ACCESS_TOKEN_TTL` (15m), `REFRESH_TOKEN_TTL_DAYS` (90) | Session lifetimes. The refresh window slides while the app is used |
| backend | `R2_*` | Private document storage |
| backend | `CORS_ORIGINS` | Comma-separated web origins allowed (native apps are not subject to CORS) |
| backend | `TRUST_PROXY` | `1` when behind one reverse proxy (Render, Railway, Fly, Nginx), so rate limiting sees real client IPs |
| backend | `PORT`, `NODE_ENV` | Server |
| backend | `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD` | First owner account (`db:seed`) |
| web | `VITE_API_URL` | API address, baked in at build time (public; no secrets) |
| mobile | `EXPO_PUBLIC_API_URL` | **The only** mobile variable. It is public by design; never put secrets in `EXPO_PUBLIC_*` |

## 4. Quality checks

```bash
npm run typecheck && npm run lint && npm test
```

The backend suite (111 tests) runs against a real PostgreSQL database (`room_rent_test`, created and migrated
automatically on first run; override with `TEST_DATABASE_URL`; the name must contain "test"). The mobile package has unit tests for its formatting and validation helpers, and CI (`.github/workflows/ci.yml`) also bundles the Android app. It covers login, refresh rotation and reuse detection, logout, room assignment
(including concurrent requests), move-out, rent changes, electricity and bill maths, duplicate-bill prevention, carry-forward,
partial payments and races, outstanding balances, document authorisation and validation, PDF contents, reports, and the full
28-step acceptance scenario (`apps/backend/test/acceptance.e2e-spec.ts`).

> Step-by-step hosting guide (Supabase, R2, Render, Vercel): [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Config files: `render.yaml` (API) and `vercel.json` (website).

## 5. Deploy the API

**Container (any host: Render, Railway, Fly.io, a VPS).** `docker build -t rent-manager-api .` from the repo root, then run it with the
backend variables above, `NODE_ENV=production` and `TRUST_PROXY=1`. The container applies pending migrations on start
(`prisma migrate deploy`) and exposes `/health`. Terminate HTTPS at the platform's proxy.
> The Dockerfile was written and reviewed but could not be built in the authoring environment (no Docker daemon). Build it once in CI before relying on it.

**Without Docker.** `npm ci && npm run -w @rental/backend build`, then from `apps/backend`: `npx prisma migrate deploy --schema ../../prisma/schema.prisma && node dist/main.js`.
The PDF fonts live in `apps/backend/assets/fonts`; deploy that folder alongside `dist/`.

First production run: set `SEED_ADMIN_USERNAME` and a strong `SEED_ADMIN_PASSWORD` (12+ chars), then `npm run -w @rental/backend prisma:seed:admin`.
Production never seeds demo data.

**Forgot the password, or login says "Incorrect username or password"?** The account keeps whatever `SEED_ADMIN_PASSWORD` was in `apps/backend/.env` when it was first created. Set `SEED_ADMIN_USERNAME` and `SEED_ADMIN_PASSWORD` in `apps/backend/.env` and run `npm run db:reset-password`; it updates that account's password and signs out all sessions.

**Row Level Security** is enabled on every table by migration `20261006000000_enable_rls` (run `npm run db:deploy`). The API connects as the database owner and is unaffected; Supabase's public REST API (`anon`/`authenticated`) can no longer read or write anything.

## 6. Web app (laptop and phone browsers, installable on iPhone)

`apps/web` is a separate website (Vite + React + Tailwind) that talks to the same API as the phone app, so iPhone users do not need the App Store.
It is responsive: phones get the bottom-tab layout, tablets get card grids, and laptops get a sidebar.

```bash
# apps/web/.env  (copy from .env.example)
VITE_API_URL=http://localhost:3000

# apps/backend/.env : allow the dev site to call the API
CORS_ORIGINS=http://localhost:5173

npm run backend             # API on :3000
npm run web                 # website with hot reload on http://localhost:5173
npm run web:build           # static site in apps/web/dist
npm run web:preview         # serve the built site on :5173
```

Deploy `apps/web/dist` to any static host. **Vercel**: import the repo, leave the Root Directory as the repo root (`vercel.json` supplies the build command,
output folder, deep-link rewrite and security headers), set `VITE_API_URL` to your API address, and replace `https://api.example.com` in `vercel.json`'s `connect-src`.
**Cloudflare Pages**: build command `npm ci && npm run web:build`, output directory `apps/web/dist`, and set `VITE_API_URL`; `public/_redirects` and `public/_headers` are included
(replace the API origin in `_headers`). Then:

1. On the **backend**, set `CORS_ORIGINS=https://your-web-domain` (comma-separated for several) and `TRUST_PROXY=1`.
2. Serve both over HTTPS (required for camera access and installing to the home screen).

**iPhone:** there is no APK equivalent on iOS (TestFlight and sideloading need a paid Apple Developer account, about $99/year). Open the site in Safari, tap Share, then *Add to Home Screen*. It opens full screen with its own icon like an app.
**Android/desktop Chrome:** use the install icon in the address bar. Camera capture, file upload, PDF view/download and Share work in the browser
(iPhone Safari offers the native share sheet for the PDF; desktop browsers download it instead).

Web security note: on the web the session tokens live in the browser's `localStorage` (phones use the secure keystore). The short 15-minute
access token, rotating refresh token with replay detection, and the strict Content-Security-Policy in `vercel.json`/`_headers` limit the risk; keep the CSP
and do not add third-party scripts to the site. Signing out revokes the session on the server.

## 7. Build the Android app

```bash
cd apps/mobile
# set EXPO_PUBLIC_API_URL (https) in eas.json or as an EAS environment variable
npx eas-cli@latest build -p android --profile preview      # installable APK for testing
npx eas-cli@latest build -p android --profile production   # Play Store bundle
```
Camera, document picker, sharing and PDF viewing use native modules, so use an EAS build or a development build
(`npx expo run:android`) rather than relying on Expo Go. iOS uses the same code: `eas build -p ios` (needs an Apple developer account).

## 8. Security summary

- Passwords hashed with **argon2id**; login errors are generic and timing-equalised; login is rate limited (8/min/IP) and all routes are throttled.
- **Access token 15 min, refresh token rotating** (hash stored server-side). Replaying an old refresh token revokes the session; a 30 s grace window tolerates a lost response. Tokens are stored only in **Expo SecureStore**; passwords are never stored on the phone. Logout revokes the session server-side. Disabling the account or changing the password signs devices out.
- Every query is scoped to the owning user (tests prove another account gets 404 everywhere). Prisma parameterises SQL; the three raw queries use bound parameters.
- Documents: stored under opaque UUID keys in a **private** bucket, validated by file **content** (JPEG/PNG/WebP/PDF, 10 MB max), served only through **5-minute signed URLs** issued after an ownership check and audited. The viewer blocks screenshots on-device.
- Helmet headers, strict CORS (no origins by default), `Cache-Control: no-store` on every API response, validation with whitelisting on every DTO, errors never expose stack traces or driver messages.
- Money is calculated **server-side** in integer paise; totals sent by the client are rejected. History is protected by database constraints and triggers (frozen bill amounts, append-only payments, one active assignment per room/tenant, one live bill per tenant and month).
- Never logged: passwords, tokens, signed URLs, storage keys, document contents. Audit entries record actions and ids only.
- `npm audit` (production dependencies) reports nothing in runtime backend packages; the remaining findings are in Expo/Metro build tooling and the Prisma CLI.

## 9. Behaviour notes and current limits

- **Carry-forward**: a new bill includes the tenant's unpaid balance as *Previous balance*; the older bills are linked (`carried forward`) and their amounts never change. Payments go to the newest bill. Bills must be generated in month order.
- **PDF**: the default bill PDF is the owner's one-table monthly rent form (tenant, room, month, rent, electricity, society charges, outstanding, monthly payment). The formal A4 invoice is still available at `/bills/:id/pdf?format=invoice`.
- **Overdue** is derived from the due date at read time.
- **Cancelling** a bill is only possible with no payments; it frees the month and the meter reading so the bill can be regenerated. Recorded payments are permanent (no reversal yet).
- `DRAFT` exists as a status but bills are generated directly (no draft editing in the MVP).
- Rent is billed per whole month (no proration for mid-month move-in or move-out).
- Not included, by design for the MVP: tenant login/portal, OTP/social login, WhatsApp Business API, SMS/email automation, online payments, accounting, offline-first sync.

## 10. Known gaps to be aware of

- The native share sheet, camera capture and Android PDF viewer are implemented with Expo's native modules and compile into the Android bundle, but they could only be exercised through the browser preview in the authoring environment. Do one pass on a real phone before launch (camera permission prompt, "Take Photo", Share to WhatsApp, View PDF).
- The web app was exercised in Chromium with an iPhone profile, not in real Safari or on a real iPhone. Before launch, install it on the client's iPhone and try login, photo capture, View PDF, Share and Add to Home Screen.
- Supabase and R2 were verified against a local PostgreSQL and the R2 request signing logic, not against live Supabase/R2 accounts (no keys were available).
