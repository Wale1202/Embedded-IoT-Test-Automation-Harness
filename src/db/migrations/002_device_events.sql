-- Device event log: every detected failure / anomaly is recorded here.
-- Idempotent so the migration runner can re-apply it safely.
--
-- device_id is intentionally NOT a foreign key: scenarios 1 (malformed)
-- and 7 (telemetry before registration) must be loggable even when no
-- matching devices row exists.

CREATE TABLE IF NOT EXISTS device_events (
  event_id    BIGSERIAL PRIMARY KEY,
  device_id   TEXT,
  event_type  TEXT NOT NULL,
  severity    TEXT NOT NULL
                CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  description TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_events_device_time
  ON device_events (device_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_device_events_severity
  ON device_events (severity, created_at DESC);
