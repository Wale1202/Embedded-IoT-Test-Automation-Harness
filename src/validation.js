// All input rules in one place: hard validation (reject) and soft
// anomaly detection (accept but flag). Kept as plain functions so each
// one is trivial to unit-test and easy to explain.
const config = require('./config');
const { EVENT_TYPES, SEVERITY } = require('./events');

// Plausible physical bounds for the simulated sensors.
const LIMITS = {
  temperature: { min: -55, max: 150, unit: '°C' }, // operating range
  batteryLevel: { min: 0, max: 100, unit: '%' }, // charge percentage
  signalStrength: { min: -120, max: 0, unit: 'dBm' }, // RSSI
};

function classifyNumber(value) {
  if (value === undefined || value === null) return 'MISSING';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'TYPE';
  return 'OK';
}

// --- Hard validation -----------------------------------------------------

// Returns string[] of problems (empty = valid).
function validateDeviceRegistration(body) {
  const errors = [];
  const { device_id, device_name, firmware_version } = body || {};

  if (!device_id || typeof device_id !== 'string' || !device_id.trim()) {
    errors.push('device_id is required and must be a non-empty string');
  }
  if (!device_name || typeof device_name !== 'string' || !device_name.trim()) {
    errors.push('device_name is required and must be a non-empty string');
  }
  if (
    !firmware_version ||
    typeof firmware_version !== 'string' ||
    !firmware_version.trim()
  ) {
    errors.push('firmware_version is required and must be a non-empty string');
  }
  return errors;
}

// Returns structured errors { field, code, message } where code is:
//   MISSING - required field absent      (failure scenario 5)
//   TYPE    - present but not a number    (scenario 1/5)
//   RANGE   - numeric but extreme         (scenario 4)
// The telemetry route maps these codes to the right event type.
function validateTelemetry(body) {
  const b = body || {};
  const errors = [];
  const { device_id, temperature, signal_strength, battery_level } = b;

  if (!device_id || typeof device_id !== 'string' || !device_id.trim()) {
    errors.push({
      field: 'device_id',
      code: 'MISSING',
      message: 'device_id is required and must be a non-empty string',
    });
  }

  const numeric = [
    ['temperature', temperature, LIMITS.temperature],
    ['battery_level', battery_level, LIMITS.batteryLevel],
    ['signal_strength', signal_strength, LIMITS.signalStrength],
  ];
  for (const [field, value, lim] of numeric) {
    const kind = classifyNumber(value);
    if (kind === 'MISSING') {
      errors.push({
        field,
        code: 'MISSING',
        message: `${field} is required and must be a finite number`,
      });
    } else if (kind === 'TYPE') {
      errors.push({
        field,
        code: 'TYPE',
        message: `${field} must be a finite number`,
      });
    } else if (value < lim.min || value > lim.max) {
      errors.push({
        field,
        code: 'RANGE',
        message: `${field} ${value} is out of range [${lim.min}, ${lim.max}] ${lim.unit}`,
      });
    }
  }

  if (b.timestamp !== undefined && b.timestamp !== null) {
    if (Number.isNaN(new Date(b.timestamp).getTime())) {
      errors.push({
        field: 'timestamp',
        code: 'TYPE',
        message: 'timestamp is not a valid date',
      });
    }
  }
  return errors;
}

// --- Soft anomaly detection (accept the frame, log a warning) ------------

function detectValueAnomalies({ temperature, signal_strength, battery_level }) {
  const out = [];
  if (battery_level < config.batteryLowPct) {
    out.push({
      type: EVENT_TYPES.LOW_BATTERY,
      severity: SEVERITY.WARNING,
      description: `battery_level ${battery_level}% is below low threshold ${config.batteryLowPct}%`,
    });
  }
  if (signal_strength < config.signalWeakDbm) {
    out.push({
      type: EVENT_TYPES.WEAK_SIGNAL,
      severity: SEVERITY.WARNING,
      description: `signal_strength ${signal_strength} dBm is weaker than threshold ${config.signalWeakDbm} dBm`,
    });
  }
  if (temperature > config.tempHighC) {
    out.push({
      type: EVENT_TYPES.HIGH_TEMPERATURE,
      severity: SEVERITY.WARNING,
      description: `temperature ${temperature}°C is above high threshold ${config.tempHighC}°C`,
    });
  }
  return out;
}

// Scenario 6: device-supplied timestamp too old, or implausibly ahead.
function detectTimestampAnomaly(clientTs) {
  if (!clientTs) return null;
  const ageSeconds = (Date.now() - clientTs.getTime()) / 1000;

  if (ageSeconds > config.staleTimestampSeconds) {
    return {
      type: EVENT_TYPES.STALE_TIMESTAMP,
      severity: SEVERITY.WARNING,
      description: `telemetry timestamp is stale by ${Math.round(ageSeconds)}s (threshold ${config.staleTimestampSeconds}s)`,
    };
  }
  if (-ageSeconds > config.clockSkewFutureSeconds) {
    return {
      type: EVENT_TYPES.STALE_TIMESTAMP,
      severity: SEVERITY.WARNING,
      description: `telemetry timestamp is ${Math.round(-ageSeconds)}s in the future (clock skew, threshold ${config.clockSkewFutureSeconds}s)`,
    };
  }
  return null;
}

module.exports = {
  LIMITS,
  validateDeviceRegistration,
  validateTelemetry,
  detectValueAnomalies,
  detectTimestampAnomaly,
};
