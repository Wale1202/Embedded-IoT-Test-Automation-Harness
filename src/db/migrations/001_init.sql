-- Schema for the MVP. Safe to run repeatedly (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS devices (
  device_id        TEXT PRIMARY KEY,
  device_name      TEXT NOT NULL,
  firmware_version TEXT NOT NULL,
  -- Lifecycle state. Constrained so a bad write fails loudly at the DB.
  status           TEXT NOT NULL DEFAULT 'offline'
                     CHECK (status IN ('online', 'offline', 'error')),
  -- NULL until the device's first telemetry frame arrives.
  last_seen        TIMESTAMPTZ,
  registered_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telemetry (
  telemetry_id    BIGSERIAL PRIMARY KEY,
  device_id       TEXT NOT NULL REFERENCES devices(device_id),
  temperature     DOUBLE PRECISION NOT NULL,
  signal_strength DOUBLE PRECISION NOT NULL,
  battery_level   DOUBLE PRECISION NOT NULL,
  -- Device-supplied time if given, otherwise server receive time.
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- History queries are always "latest first for one device".
CREATE INDEX IF NOT EXISTS idx_telemetry_device_time
  ON telemetry (device_id, timestamp DESC);
