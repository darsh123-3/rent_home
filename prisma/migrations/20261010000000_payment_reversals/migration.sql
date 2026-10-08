-- Undoing a payment recorded by mistake. Payments stay append-only: instead of deleting the payment, a reversal row with
-- the negative amount is added and points at it. Each payment can be reversed once.

ALTER TABLE "payments" ADD COLUMN "reversal_of_id" UUID;
CREATE UNIQUE INDEX "payments_reversal_of_id_key" ON "payments"("reversal_of_id");
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversal_of_id_fkey"
  FOREIGN KEY ("reversal_of_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Positive amounts for payments; a negative amount only for a reversal.
ALTER TABLE "payments" DROP CONSTRAINT "payments_amount_positive";
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive"
  CHECK (("reversal_of_id" IS NULL AND "amount" > 0) OR ("reversal_of_id" IS NOT NULL AND "amount" < 0));
