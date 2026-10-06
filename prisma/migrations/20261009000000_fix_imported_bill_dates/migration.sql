-- Bills imported from the Excel register were given the billing month's own dates: the August bill was
-- "issued" on 01 Aug and due on 10 Aug. Month M is billed after it ends, so (like bills generated in the app)
-- it is issued on the 1st of M+1 and due on the due day of M+1.
-- Only imported bills that still have same-month dates are touched, so running this twice changes nothing.
-- Amounts are not touched (due_date and created_at are not frozen by the bills_freeze_amounts trigger).

UPDATE "bills"
   SET "due_date" = ("due_date" + INTERVAL '1 month')::date
 WHERE "notes" LIKE 'Imported from the Excel register%'
   AND "due_date" < ("billing_period" + INTERVAL '1 month')::date;

UPDATE "bills"
   SET "created_at" = LEAST(("billing_period" + INTERVAL '1 month')::timestamp, NOW()::timestamp)
 WHERE "notes" LIKE 'Imported from the Excel register%'
   AND "created_at" < ("billing_period" + INTERVAL '1 month')::timestamp;
