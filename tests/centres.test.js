const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/prisma');
const { uniqueName, createUserAndToken } = require('./helpers/testUtils');

// Track everything we create so cleanup removes ONLY our rows, in FK-safe order.
const userIds = [];
const centreIds = [];

let auth; // an authenticated user reused across "authorized" cases

beforeAll(async () => {
  auth = await createUserAndToken(app, { name: 'Centre Owner' });
  userIds.push(auth.userId);
});

afterAll(async () => {
  // FK order: tests reference centres (onDelete Restrict) -> delete tests first,
  // then centres, then users. Scope strictly to rows tied to our test data.
  await prisma.diagnosticTest.deleteMany({ where: { centreId: { in: centreIds } } });
  await prisma.diagnosticCentre.deleteMany({ where: { id: { in: centreIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

// Helper: create a centre via the API as the authenticated user, and track it.
async function createCentre(overrides = {}) {
  const body = {
    name: overrides.name || uniqueName('Centre'),
    location: overrides.location || 'Test City',
  };
  const res = await request(app)
    .post('/api/centres')
    .set('Authorization', auth.authHeader)
    .send(body);
  if (res.body && res.body.centre && res.body.centre.id) {
    centreIds.push(res.body.centre.id);
  }
  return { res, body };
}

// ---------------------------------------------------------------------------
// Centres
// ---------------------------------------------------------------------------

describe('Centres', () => {
  test('authenticated user can create a centre (201)', async () => {
    const name = uniqueName('Centre');
    const { res } = await createCentre({ name, location: 'Bengaluru' });

    expect(res.status).toBe(201);
    expect(res.body.centre).toBeDefined();
    expect(res.body.centre.id).toBeDefined();
    expect(res.body.centre.name).toBe(name);
    expect(res.body.centre.location).toBe('Bengaluru');

    const stored = await prisma.diagnosticCentre.findUnique({ where: { id: res.body.centre.id } });
    expect(stored).not.toBeNull();
    expect(stored.name).toBe(name);
  });

  test('unauthenticated user cannot create a centre (401)', async () => {
    const res = await request(app)
      .post('/api/centres')
      .send({ name: uniqueName('Centre'), location: 'Nowhere' });

    expect(res.status).toBe(401);
  });

  test('centre validation errors are rejected (400)', async () => {
    const res = await request(app)
      .post('/api/centres')
      .set('Authorization', auth.authHeader)
      .send({ name: '', location: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('public user can list centres (200)', async () => {
    await createCentre();
    const res = await request(app).get('/api/centres');

    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe('number');
    expect(Array.isArray(res.body.centres)).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  test('public user can get a centre by ID (200)', async () => {
    const { res: created } = await createCentre({ name: uniqueName('Centre'), location: 'Chennai' });
    const id = created.body.centre.id;

    const res = await request(app).get(`/api/centres/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.centre.id).toBe(id);
    expect(res.body.centre.location).toBe('Chennai');
    expect(Array.isArray(res.body.centre.tests)).toBe(true);
  });

  test('invalid centre UUID returns 400', async () => {
    const res = await request(app).get('/api/centres/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('nonexistent centre returns 404', async () => {
    const res = await request(app).get(`/api/centres/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NotFound');
  });
});

// ---------------------------------------------------------------------------
// Diagnostic tests (nested under a centre)
// ---------------------------------------------------------------------------

describe('Diagnostic tests', () => {
  let centreId;

  beforeAll(async () => {
    const { res } = await createCentre({ name: uniqueName('Centre'), location: 'Hyderabad' });
    centreId = res.body.centre.id;
  });

  // Helper: create a test under the shared centre via the API.
  async function createTest(overrides = {}) {
    const body = {
      name: overrides.name || uniqueName('Test'),
      price: overrides.price !== undefined ? overrides.price : 499.99,
    };
    const res = await request(app)
      .post(`/api/centres/${overrides.centreId || centreId}/tests`)
      .set('Authorization', auth.authHeader)
      .send(body);
    return { res, body };
  }

  test('authenticated user can create a test and price is stored correctly (201)', async () => {
    const name = uniqueName('Test');
    const { res } = await createTest({ name, price: 1234.56 });

    expect(res.status).toBe(201);
    expect(res.body.test.id).toBeDefined();
    expect(res.body.test.name).toBe(name);
    expect(res.body.test.centreId).toBe(centreId);
    expect(Number(res.body.test.price)).toBe(1234.56);

    const stored = await prisma.diagnosticTest.findUnique({ where: { id: res.body.test.id } });
    expect(stored).not.toBeNull();
    expect(Number(stored.price)).toBe(1234.56);
  });

  test('unauthenticated user cannot create a test (401)', async () => {
    const res = await request(app)
      .post(`/api/centres/${centreId}/tests`)
      .send({ name: uniqueName('Test'), price: 100 });

    expect(res.status).toBe(401);
  });

  test('non-positive price is rejected (400)', async () => {
    const { res } = await createTest({ price: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('price with more than 2 decimal places is rejected (400)', async () => {
    const { res } = await createTest({ price: 10.999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('creating a test for a nonexistent centre returns 404', async () => {
    const { res } = await createTest({ centreId: crypto.randomUUID() });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NotFound');
  });

  test('creating a test with an invalid centre UUID returns 400', async () => {
    const res = await request(app)
      .post('/api/centres/not-a-uuid/tests')
      .set('Authorization', auth.authHeader)
      .send({ name: uniqueName('Test'), price: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('public user can list tests for a centre (200)', async () => {
    await createTest({ name: uniqueName('Test'), price: 250 });
    const res = await request(app).get(`/api/centres/${centreId}/tests`);

    expect(res.status).toBe(200);
    expect(res.body.centreId).toBe(centreId);
    expect(Array.isArray(res.body.tests)).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  test('public user can get a test by ID (200)', async () => {
    const { res: created } = await createTest({ name: uniqueName('Test'), price: 777.7 });
    const id = created.body.test.id;

    const res = await request(app).get(`/api/tests/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.test.id).toBe(id);
    expect(Number(res.body.test.price)).toBe(777.7);
    expect(res.body.test.centre.id).toBe(centreId);
  });

  test('invalid test UUID returns 400', async () => {
    const res = await request(app).get('/api/tests/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('nonexistent test ID returns 404', async () => {
    const res = await request(app).get(`/api/tests/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NotFound');
  });
});
