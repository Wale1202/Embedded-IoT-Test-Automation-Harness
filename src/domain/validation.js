// Input validation for device registration and telemetry frames.
//
// Each validator returns an array of human-readable error strings.
// An empty array means "valid". Routes turn a non-empty array into a
// 400 response so the client gets every problem at once, not just the
// first one - important when debugging a misbehaving embedded device.

// Plausible physical bounds for the simulated sensors. These mirror the
// kind of limits a real telemetry validation table would enforce.
const LIMITS = {
  // Industrial/space-grade sensor operating range, degrees Celsius.
  temperature: { min: -55, max: 150 },
  // Battery charge as a percentage.
  batteryLevel: { min: 0, max: 100 },
  // RSSI in dBm: 0 is a perfect link, more negative is weaker.
  signalStrength: { min: -120, max: 0 },
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// --- Device registration -------------------------------------------------

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

// --- Telemetry frame -----------------------------------------------------

function validateTelemetry(body) {
  const errors = [];
  const { device_id, temperature, signal_strength, battery_level } =
    body || {};

  // device_id is mandatory - a frame with no source is unusable.
  if (!device_id || typeof device_id !== 'string' || !device_id.trim()) {
    errors.push('device_id is required and must be a non-empty string');
  }

  // temperature: must be a real number within sensor limits.
  if (!isFiniteNumber(temperature)) {
    errors.push('temperature is required and must be a finite number');
  } else if (
    temperature < LIMITS.temperature.min ||
    temperature > LIMITS.temperature.max
  ) {
    errors.push(
      `temperature ${temperature} is out of range ` +
        `[${LIMITS.temperature.min}, ${LIMITS.temperature.max}] °C`
    );
  }

  // battery_level: percentage, 0-100 inclusive.
  if (!isFiniteNumber(battery_level)) {
    errors.push('battery_level is required and must be a finite number');
  } else if (
    battery_level < LIMITS.batteryLevel.min ||
    battery_level > LIMITS.batteryLevel.max
  ) {
    errors.push(
      `battery_level ${battery_level} is out of range ` +
        `[${LIMITS.batteryLevel.min}, ${LIMITS.batteryLevel.max}] %`
    );
  }

  // signal_strength: RSSI in dBm, within the expected link budget.
  if (!isFiniteNumber(signal_strength)) {
    errors.push('signal_strength is required and must be a finite number');
  } else if (
    signal_strength < LIMITS.signalStrength.min ||
    signal_strength > LIMITS.signalStrength.max
  ) {
    errors.push(
      `signal_strength ${signal_strength} is out of range ` +
        `[${LIMITS.signalStrength.min}, ${LIMITS.signalStrength.max}] dBm`
    );
  }

  return errors;
}

module.exports = {
  LIMITS,
  validateDeviceRegistration,
  validateTelemetry,
};
