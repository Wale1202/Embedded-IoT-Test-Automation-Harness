/**
 * Device simulator — pretends to be an embedded device sending
 * telemetry to the backend. It registers a device, then every few
 * seconds builds a frame for the chosen mode and POSTs it, printing
 * the backend's response. No dependencies (Node 18+ built-in fetch).
 *
 * Usage:  node simulator/device.js <mode> [deviceId] [intervalSeconds]
 * Example: node simulator/device.js invalid SIM-9 2
 *
 * Modes: normal | invalid | offline | duplicate | low-battery |
 *        weak-signal | random
 */

const BASE_URL = 'http://localhost:3000'; // edit if your backend differs

// Command-line arguments (positional, so there's nothing to explain).
const mode = process.argv[2] || 'normal';
const deviceId = process.argv[3] || 'SIM-001';
const intervalMs = (Number(process.argv[4]) || 3) * 1000;

// Random number in a range, rounded to 1 decimal.
const rand = (min, max) => Math.round((min + Math.random() * (max - min)) * 10) / 10;

const frame = (temperature, signal_strength, battery_level) => ({
  device_id: deviceId,
  temperature,
  signal_strength,
  battery_level,
});

// Fixed frame (same timestamp every time) so "duplicate" trips the
// backend's duplicate detection.
const DUPLICATE = { ...frame(22.5, -75, 60), timestamp: new Date().toISOString() };

// One builder per mode. `offline` returns null = "send nothing".
const builders = {
  normal: () => frame(rand(20, 30), rand(-80, -60), rand(40, 100)),
  invalid: () => frame(999, 50, 140), // every value out of range -> 400
  'low-battery': () => frame(rand(20, 30), rand(-80, -60), rand(1, 10)),
  'weak-signal': () => frame(rand(20, 30), rand(-118, -101), rand(40, 90)),
  duplicate: () => DUPLICATE,
  offline: () => null,
};

if (mode !== 'random' && !builders[mode]) {
  console.error(`Unknown mode "${mode}". Modes: ${Object.keys(builders).join(', ')}, random`);
  process.exit(1);
}

async function post(path, body) {
  const res = await fetch(BASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function sendTick() {
  // In random mode, pick a fresh behaviour each tick.
  const active =
    mode === 'random'
      ? Object.keys(builders)[Math.floor(Math.random() * Object.keys(builders).length)]
      : mode;

  const frameBody = builders[active]();
  if (frameBody === null) {
    console.log(`[offline] silent — try: curl -X POST ${BASE_URL}/api/v1/devices/offline-sweep`);
    return;
  }

  const { status, body } = await post('/api/v1/telemetry', frameBody);
  console.log(`[${active}] HTTP ${status}`, JSON.stringify(body));
}

async function main() {
  console.log(`Simulator: device=${deviceId} mode=${mode} interval=${intervalMs / 1000}s`);

  const reg = await post('/api/v1/devices', {
    device_id: deviceId,
    device_name: `Simulated ${deviceId}`,
    firmware_version: '1.0.0',
  });
  console.log(
    reg.status === 201
      ? `[register] ${deviceId} registered.`
      : `[register] ${deviceId}: HTTP ${reg.status} (continuing).`
  );

  await sendTick(); // one immediately, then on the interval
  setInterval(sendTick, intervalMs);
}

main().catch((err) => {
  console.error(`Cannot reach backend at ${BASE_URL} — is it running? (${err.message})`);
  process.exit(1);
});
