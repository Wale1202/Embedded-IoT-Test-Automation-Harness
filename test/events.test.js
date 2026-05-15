// Event-logging verification (TC-09). The HTTP response tells the
// device what happened; the device_events row tells the engineer. These
// tests assert the audit trail exists with the right type + severity -
// the part that proves the harness *detected* each failure, not just
// rejected it.
const request = require('supertest');
const app = require('../src/app');
const { seedDevice, getEvents } = require('./helpers/db');

const base = {
  device_id: 'DEV-1',
  temperature: 20,
  signal_strength: -70,
  battery_level: 80,
};

describe('Event logging on bad telemetry (TC-09)', () => {
  test('TC-09 missing fields -> MISSING_FIELDS (warning) logged', async () => {
    await request(app)
      .post('/api/v1/telemetry')
      .send({ device_id: 'DEV-1' }); // numeric fields absent

    const events = await getEvents('DEV-1');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'MISSING_FIELDS',
          severity: 'warning',
        }),
      ])
    );
  });

  test('TC-09 extreme values -> EXTREME_VALUE (critical) logged', async () => {
    await seedDevice('DEV-1');
    await request(app)
      .post('/api/v1/telemetry')
      .send({ ...base, temperature: 999, battery_level: 140 });

    const events = await getEvents('DEV-1');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'EXTREME_VALUE',
          severity: 'critical',
        }),
      ])
    );
  });

  test('TC-09 unregistered device -> UNREGISTERED_DEVICE (error) logged', async () => {
    await request(app)
      .post('/api/v1/telemetry')
      .send({ ...base, device_id: 'GHOST' });

    const events = await getEvents('GHOST');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'UNREGISTERED_DEVICE',
          severity: 'error',
        }),
      ])
    );
  });

  test('TC-09 duplicate frame -> DUPLICATE_TELEMETRY (warning) logged', async () => {
    await seedDevice('DEV-1');
    const frame = { ...base, timestamp: '2026-03-03T03:03:00.000Z' };
    await request(app).post('/api/v1/telemetry').send(frame);
    await request(app).post('/api/v1/telemetry').send(frame);

    const events = await getEvents('DEV-1');
    expect(events.map((e) => e.event_type)).toContain('DUPLICATE_TELEMETRY');
  });

  test('TC-09 soft anomaly: low battery is ACCEPTED but flagged', async () => {
    await seedDevice('DEV-1');
    const res = await request(app)
      .post('/api/v1/telemetry')
      .send({ ...base, battery_level: 5 }); // valid range, but low

    // Accepted (not rejected) ...
    expect(res.status).toBe(201);
    // ... and surfaced both in the response and the event log.
    expect(res.body.warnings.map((w) => w.type)).toContain('LOW_BATTERY');
    const events = await getEvents('DEV-1');
    expect(events.map((e) => e.event_type)).toContain('LOW_BATTERY');
  });
});

describe('Event log retrieval (TC-10)', () => {
  test('TC-10 global log filters by severity', async () => {
    await seedDevice('DEV-1');
    await request(app)
      .post('/api/v1/telemetry')
      .send({ ...base, temperature: 999 }); // -> EXTREME_VALUE (critical)

    const res = await request(app).get('/api/v1/events?severity=critical');
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.events.every((e) => e.severity === 'critical')).toBe(true);
  });
});
