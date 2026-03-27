-- M4: Add cancellation tracking fields to bookings and triggeredBy to ad_sync_log

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "cancelledBy" INTEGER;

ALTER TABLE "ad_sync_log" ADD COLUMN IF NOT EXISTS "triggeredBy" TEXT;
