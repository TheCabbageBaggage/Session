-- M5: Add exchangeEventId to bookings for Exchange/Graph sync
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "exchangeEventId" TEXT;
