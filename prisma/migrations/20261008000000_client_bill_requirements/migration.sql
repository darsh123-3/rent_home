-- Client requirements: MNGL gas charge category, rental agreement dates, security deposit receipts, landlord phone.
-- Additive only: every new column is nullable and existing rows are untouched.

-- 1. New charge category for the piped gas (MNGL) bill.
--    ALTER TYPE ... ADD VALUE may run inside the migration transaction as long as the new value is not used in it.
ALTER TYPE "ChargeType" ADD VALUE IF NOT EXISTS 'MNGL_GAS';

-- 2. Rental agreement validity (separate from end_date, which is the move-out date).
ALTER TABLE "room_assignments" ADD COLUMN "agreement_start_date" DATE;
ALTER TABLE "room_assignments" ADD COLUMN "agreement_end_date" DATE;
ALTER TABLE "room_assignments" ADD CONSTRAINT "assignment_agreement_dates_order"
  CHECK ("agreement_start_date" IS NULL OR "agreement_end_date" IS NULL OR "agreement_end_date" >= "agreement_start_date");

-- 3. Security deposit received, in one or more instalments, each with its date.
--    room_assignments.security_deposit stays the agreed amount; totals are computed from these rows.
CREATE TABLE "security_deposit_receipts" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "received_on" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_deposit_receipts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "security_deposit_receipts_assignment_id_idx" ON "security_deposit_receipts"("assignment_id");
ALTER TABLE "security_deposit_receipts" ADD CONSTRAINT "security_deposit_receipts_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "room_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "security_deposit_receipts" ADD CONSTRAINT "deposit_receipts_amount_positive" CHECK ("amount" > 0);

-- Same protection as every other table (see 20261006000000_enable_rls): only the API's owner role can touch it.
ALTER TABLE "security_deposit_receipts" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "security_deposit_receipts" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "security_deposit_receipts" FROM authenticated;
  END IF;
END $$;

-- 4. Landlord contact phone printed under the address on bills (optional).
ALTER TABLE "properties" ADD COLUMN "contact_phone" TEXT;
