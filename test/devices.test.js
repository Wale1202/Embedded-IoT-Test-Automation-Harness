// Device lifecycle: registration, status, history, offline detection.
// Each test name carries its TEST_PLAN.md ID for traceability.
const request = require('supertest');
const app = require('../src/app');
const { seedDevice } = require('./helpers/db');

describe('Device registration', () => {
  test('TC-01 registers a new device and returns it (201)', async () => {
    const res = await request(app)
      .post('/api/v1/devices')
      .send({
        device_id: 'DEV-1',
        device_name: 'Edge Sensor',
        firmware_version: '1.0.0',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      device_id: 'DEV-1',
      device_name: 'Edge Sensor',
      firmware_version: '1.0.0',
      status: 'offline', // not seen yet
      last_seen: null,
    });
  });

  test('TC-11 rejects duplicate registration of the same device_id (409)', async () => {
    await seedDevice('DEV-1');
    const res = await request(app)
      .post('/api/v1/devices')
      .send({
        device_id: 'DEV-1',
        device_name: 'Other',
        firmware_version: '2.0.0',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });
});

describe('Device status & history (TC-10)', () => {
  test('TC-10 returns current status and telemetry history newest-first', async () => {
    await seedDevice('DEV-1');

    // Submit two frames so history ordering is observable.
    await request(app)
      .post('/api/v1/telemetry')
      .send({
        device_id: 'DEV-1',
        temperature: 20,
        signal_strength: -70,
        battery_level: 80,
        timestamp: '2026-01-01T00:00:00.000Z',
      });
    await request(app)
      .post('/api/v1/telemetry')
      .send({
        device_id: 'DEV-1',
        temperature: 21,
        signal_strength: -71,
        battery_level: 79,
        timestamp: '2026-01-01T00:01:00.000Z',
      });

    const status = await request(app).get('/api/v1/devices/DEV-1/status');
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('online'); // flipped by telemetry
    expect(status.body.last_seen).not.toBeNull();

    const history = await request(app).get(
      '/api/v1/devices/DEV-1/history?limit=10'
    );
    expect(history.status).toBe(200);
    expect(history.body.count).toBe(2);
    // Newest first: the 00:01 frame precedes the 00:00 frame.
    expect(history.body.events[0].temperature).toBe(21);
    expect(history.body.events[1].temperature).toBe(20);
  });

  test('TC-10 status of an unknown device returns 404', async () => {
    const res = await request(app).get('/api/v1/devices/NOPE/status');
    expect(res.status).toBe(404);
  });
});

describe('Offline detection (TC-08)', () => {
  test('TC-08 sweep marks a previously-online but now-silent device offline', async () => {
    await seedDevice('IDLE-1');
    // Device reported once, long ago -> status online, last_seen stale.
    // (Telemetry sets last_seen to the supplied timestamp.) This models
    // the real scenario: a device that WAS online and then went silent.
    await request(app)
      .post('/api/v1/telemetry')
      .send({
        device_id: 'IDLE-1',
        temperature: 20,
        signal_strength: -70,
        battery_level: 80,
        timestamp: '2020-01-01T00:00:00.000Z',
      });

    const res = await request(app).post('/api/v1/devices/offline-sweep');
    expect(res.status).toBe(200);
    expect(res.body.device_ids).toContain('IDLE-1');

    const status = await request(app).get('/api/v1/devices/IDLE-1/status');
    expect(status.body.status).toBe('offline');

    const events = await request(app).get('/api/v1/devices/IDLE-1/events');
    expect(events.body.events.map((e) => e.event_type)).toContain(
      'DEVICE_OFFLINE'
    );
  });

  test('TC-08 sweep does NOT mark a device that just reported', async () => {
    await seedDevice('LIVE-1');
    await request(app)
      .post('/api/v1/telemetry')
      .send({
        device_id: 'LIVE-1',
        temperature: 20,
        signal_strength: -70,
        battery_level: 90,
      }); // server timestamp = now -> well within threshold

    const res = await request(app).post('/api/v1/devices/offline-sweep');
    expect(res.body.device_ids).not.toContain('LIVE-1');

    const status = await request(app).get('/api/v1/devices/LIVE-1/status');
    expect(status.body.status).toBe('online');
  });
});
