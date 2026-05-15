// Telemetry ingest: the happy path plus every rejection rule.
// The pattern throughout: assert the HTTP contract (status + message),
// not just the status code - a clear error message is a requirement.
const request = require('supertest');
const app = require('../src/app');
const { seedDevice } = require('./helpers/db');

const validFrame = {
  device_id: 'DEV-1',
  temperature: 21.5,
  signal_strength: -78,
  battery_level: 87,
};

describe('Telemetry submission', () => {
  test('TC-02 accepts a valid frame, stores it, marks device online (201)', async () => {
    await seedDevice('DEV-1');

    const res = await request(app).post('/api/v1/telemetry').send(validFrame);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      device_id: 'DEV-1',
      temperature: 21.5,
      signal_strength: -78,
      battery_level: 87,
    });
    expect(res.body.telemetry_id).toBeDefined();
    expect(res.body.warnings).toEqual([]); // nominal -> no anomalies

    const status = await request(app).get('/api/v1/devices/DEV-1/status');
    expect(status.body.status).toBe('online');
  });
});

describe('Telemetry validation (rejection rules)', () => {
  test('TC-03 rejects missing device_id (400, clear message)', async () => {
    const { device_id, ...noId } = validFrame;
    const res = await request(app).post('/api/v1/telemetry').send(noId);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details.join(' ')).toMatch(/device_id is required/i);
  });

  test('TC-04 rejects battery_level outside 0-100 (400)', async () => {
    await seedDevice('DEV-1');
    const res = await request(app)
      .post('/api/v1/telemetry')
      .send({ ...validFrame, battery_level: 140 });

    expect(res.status).toBe(400);
    expect(res.body.details.join(' ')).toMatch(
      /battery_level 140 is out of range/i
    );
  });

  test('TC-05 rejects invalid temperature - out of range (400)', async () => {
    await seedDevice('DEV-1');
    const res = await request(app)
      .post('/api/v1/telemetry')
      .send({ ...validFrame, temperature: 999 });

    expect(res.status).toBe(400);
    expect(res.body.details.join(' ')).toMatch(
      /temperature 999 is out of range/i
    );
  });

  test('TC-05 rejects invalid temperature - non-numeric (400)', async () => {
    await seedDevice('DEV-1');
    const res = await request(app)
      .post('/api/v1/telemetry')
      .send({ ...validFrame, temperature: 'hot' });

    expect(res.status).toBe(400);
    expect(res.body.details.join(' ')).toMatch(
      /temperature must be a finite number/i
    );
  });

  test('TC-12 rejects a malformed JSON body (400)', async () => {
    const res = await request(app)
      .post('/api/v1/telemetry')
      .set('Content-Type', 'application/json')
      .send('{ this is not json');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not valid JSON/i);
  });
});

describe('Telemetry integrity rules', () => {
  test('TC-06 rejects telemetry from an unregistered device (404)', async () => {
    const res = await request(app)
      .post('/api/v1/telemetry')
      .send({ ...validFrame, device_id: 'GHOST' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not registered/i);
  });

  test('TC-07 detects duplicate telemetry (same device + timestamp) (409)', async () => {
    await seedDevice('DEV-1');
    const frame = { ...validFrame, timestamp: '2026-02-02T12:00:00.000Z' };

    const first = await request(app).post('/api/v1/telemetry').send(frame);
    expect(first.status).toBe(201);

    const dup = await request(app).post('/api/v1/telemetry').send(frame);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/duplicate/i);
  });
});
