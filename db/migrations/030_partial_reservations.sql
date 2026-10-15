BEGIN;

ALTER TABLE ci_reservation
  ADD COLUMN IF NOT EXISTS consumed_qty bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS released_qty bigint NOT NULL DEFAULT 0;

UPDATE ci_reservation
SET consumed_qty = CASE WHEN status = 'consumed' THEN quantity ELSE 0 END,
    released_qty = CASE WHEN status = 'released' THEN quantity ELSE 0 END
WHERE status IN ('consumed', 'released') AND consumed_qty = 0 AND released_qty = 0;

ALTER TABLE ci_reservation
  DROP CONSTRAINT IF EXISTS ci_reservation_status_check,
  DROP CONSTRAINT IF EXISTS ci_reservation_partial_quantities_check,
  ADD CONSTRAINT ci_reservation_status_check CHECK (status IN ('active', 'released', 'consumed', 'closed_partial')),
  ADD CONSTRAINT ci_reservation_partial_quantities_check CHECK (
    consumed_qty >= 0 AND released_qty >= 0
    AND consumed_qty <= quantity AND released_qty <= quantity
    AND consumed_qty + released_qty <= quantity
  );

COMMIT;
