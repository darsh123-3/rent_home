# Architecture & Implementation Plan

Modular monolith. `apps/mobile` (Expo/React Native) talks only to `apps/backend` (NestJS REST).
The backend owns Supabase PostgreSQL (via Prisma) and the private Cloudflare R2 bucket.

## Key decisions
- **npm workspaces** monorepo: `apps/backend`, `apps/mobile`, `packages/shared` (enums + shared types). Prisma schema lives at `prisma/schema.prisma`.
- **Versions**: NestJS 11, Prisma 6, Expo (latest SDK), Expo Router, NativeWind, lucide-react-native.
- **Auth**: username/password -> argon2id verify -> 15 min JWT access token + rotating opaque refresh token
  (`<sessionId>.<secret>`; only a SHA-256 of the secret is stored in `sessions`). Reusing a stale refresh secret revokes the session.
  Mobile keeps both tokens in Expo SecureStore only; a single in-flight refresh is shared across concurrent 401s.
- **Money**: stored as `Decimal(12,2)`, calculated server-side in integer paise (`billing/bill-calculator.ts`), never trusting client totals.
- **History is immutable**: `room_assignments` keep tenant<->room history; `rent_history` holds effective-dated rent;
  bills snapshot all lines into `bill_items`; a DB trigger blocks edits to bill amounts; payments never change a bill's `total_due`.
- **Carry-forward**: a new bill includes `previous_balance` (unpaid balance of the tenant's earlier open bills). Those older bills get
  `carried_forward_to_id` (a link, amounts untouched), so outstanding = sum of balances of bills that are not carried forward.
- **DB-level rules**: partial unique index (one ACTIVE assignment per room and per tenant), unique (assignment, billing period),
  CHECK constraints (payment > 0, current reading >= previous), soft-delete for tenants/documents.
- **Documents**: mobile uploads multipart to the backend (validated type/size, magic bytes), backend puts to private R2;
  viewing returns a short-lived presigned GET URL after an auth check. No public URLs.
- **PDF**: generated on the backend with PDFKit; mobile downloads it with Expo FileSystem and opens the native share sheet.
- **Overdue** is computed at read time from `due_date`, so no cron is needed.
- **Time zone**: every "today" on the server is `todayLocal()` (`common/dates.ts`), the calendar day in `APP_TIMEZONE` (default Asia/Kolkata) as a UTC-midnight
  Date that compares directly with `DATE` columns. Never use the server clock's date: Render runs in UTC, which is still yesterday until 05:30 IST.
- **Computed, not stored**: bill period (first to last day of `billing_period`), "issued on" (India day of `created_at`), deposit totals
  (sum of `security_deposit_receipts`), agreement status (`agreement_start_date`/`agreement_end_date` against today), paid-in-full / last payment dates.
- **Charge lines**: Water, Housekeeping (`CLEANING`), MNGL fuel (`MNGL_GAS`) and WiFi (`INTERNET`) are `CHARGE` bill items with `meta.chargeType`
  (and an optional `meta.note`), ordered right after electricity and limited to one each per bill. They add to `other_charges_amount` like any charge.

## Phases (one commit per step)
1. Foundation: monorepo, backend (config, Prisma, auth, sessions), mobile shell (theme, icons, tabs, persistent login)
2. Properties & Rooms
3. Tenants, room assignment, move-out
4. Documents + R2
5. Billing
6. Payments
7. PDF & sharing
8. Dashboard & reports
9. Hardening, tests, deployment docs
