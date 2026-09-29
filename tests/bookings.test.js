const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/prisma');
const { uniqueName, createUserAndToken } = require('./helpers/testUtils');

// Track created rows for FK-safe, targeted cleanup.
const userIds = [];
const centreIds = [];

let userA; // booking owner
let userB; // a different authenticated user
let centreId; // centre that owns `testId`
let otherCentreId; // a second, unrelated centre
let testId; // diagnostic test under `centreId`
const TEST_PRICE = 499.99;

function futureISO(daysAhead = 7) {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
}

function pastISO(daysAgo = 7) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

// Create a booking through the API and track its id for cleanup.
async function createBooking(user, body) {
  const res = await request(app)
    .post('/api/bookings')
    .set('Authorization', user.authHeader)
    .send(body);
  if (res.body && res.body.booking && res.body.booking.id) {
    // Defensive: also covered by cleanup-by-userId, but keep it explicit.
  }
  return res;
}

beforeAll(async () => {
  userA = await createUserAndToken(app, { name: 'Booker A' });
  userB = await createUserAndToken(app, { name: 'Booker B' });
  userIds.push(userA.userId, userB.userId);

  // A centre + test owned by A (via API), plus a second unrelated centre.
  const centreRes = await request(app)
    .post('/api/centres')
    .set('Authorization', userA.authHeader)
    .send({ name: uniqueName('Centre'), location: 'Test City' });
  centreId = centreRes.body.centre.id;
  centreIds.push(centreId);

  const otherCentreRes = await request(app)
    .post('/api/centres')
    .set('Authorization', userA.authHeader)
    .send({ name: uniqueName('Centre'), location: 'Other City' });
  otherCentreId = otherCentreRes.body.centre.id;
  centreIds.push(otherCentreId);

  const testRes = await request(app)
    .post(`/api/centres/${centreId}/tests`)
    .set('Authorization', userA.authHeader)
    .send({ name: uniqueName('Test'), price: TEST_PRICE });
  testId = testRes.body.test.id;
});

afterAll(async () => {
  // FK order (all relations onDelete: Restrict): bookings -> tests -> centres -> users.
  await prisma.booking.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.diagnosticTest.deleteMany({ where: { centreId: { in: centreIds } } });
  await prisma.diagnosticCentre.deleteMany({ where: { id: { in: centreIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Creating bookings
// ---------------------------------------------------------------------------

describe('POST /api/bookings', () => {
  test('authenticated user can create a booking: 201, PENDING, amount from test price', async () => {
    const res = await createBooking(userA, { testId, centreId, appointmentDateTime: futureISO() });

    expect(res.status).toBe(201);
    expect(res.body.booking).toBeDefined();
    expect(res.body.booking.status).toBe('PENDING');
    expect(res.body.booking.userId).toBe(userA.userId);
    expect(res.body.booking.testId).toBe(testId);
    expect(res.body.booking.centreId).toBe(centreId);
    // Amount is derived from DiagnosticTest.price, not the client.
    expect(Number(res.body.booking.amount)).toBe(TEST_PRICE);

    const stored = await prisma.booking.findUnique({ where: { id: res.body.booking.id } });
    expect(stored.userId).toBe(userA.userId);
    expect(stored.status).toBe('PENDING');
    expect(Number(stored.amount)).toBe(TEST_PRICE);
  });

  test('unauthenticated user cannot create a booking (401)', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ testId, centreId, appointmentDateTime: futureISO() });
    expect(res.status).toBe(401);
  });

  test('booking uses JWT identity, ignoring a userId supplied in the body', async () => {
    const res = await createBooking(userA, {
      testId,
      centreId,
      appointmentDateTime: futureISO(),
      userId: userB.userId, // attacker-supplied; must be ignored
    });

    expect(res.status).toBe(201);
    expect(res.body.booking.userId).toBe(userA.userId);
    expect(res.body.booking.userId).not.toBe(userB.userId);
  });

  test('booking amount ignores a client-supplied amount and uses the DB price', async () => {
    const res = await createBooking(userA, {
      testId,
      centreId,
      appointmentDateTime: futureISO(),
      amount: 1, // must be ignored
    });

    expect(res.status).toBe(201);
    expect(Number(res.body.booking.amount)).toBe(TEST_PRICE);
  });

  test('nonexistent test returns 404', async () => {
    const res = await createBooking(userA, {
      testId: crypto.randomUUID(),
      centreId,
      appointmentDateTime: futureISO(),
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NotFound');
  });

  test('nonexistent centre returns 404', async () => {
    const res = await createBooking(userA, {
      testId,
      centreId: crypto.randomUUID(),
      appointmentDateTime: futureISO(),
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NotFound');
  });

  test('test belonging to a different centre is rejected (400)', async () => {
    const res = await createBooking(userA, {
      testId, // belongs to centreId
      centreId: otherCentreId, // mismatched
      appointmentDateTime: futureISO(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BadRequest');
  });

  test('past appointmentDateTime is rejected (400)', async () => {
    const res = await createBooking(userA, {
      testId,
      centreId,
      appointmentDateTime: pastISO(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BadRequest');
  });

  test('malformed UUIDs are rejected (400)', async () => {
    const res = await createBooking(userA, {
      testId: 'not-a-uuid',
      centreId: 'also-not-a-uuid',
      appointmentDateTime: futureISO(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });
});

// ---------------------------------------------------------------------------
// Reading bookings + ownership
// ---------------------------------------------------------------------------

describe('GET /api/bookings + ownership', () => {
  let bookingId;

  beforeAll(async () => {
    const res = await createBooking(userA, { testId, centreId, appointmentDateTime: futureISO() });
    bookingId = res.body.booking.id;
  });

  test("list returns only the authenticated user's own bookings", async () => {
    const aList = await request(app).get('/api/bookings').set('Authorization', userA.authHeader);
    expect(aList.status).toBe(200);
    expect(aList.body.bookings.length).toBeGreaterThanOrEqual(1);
    expect(aList.body.bookings.every((b) => b.userId === userA.userId)).toBe(true);
    expect(aList.body.bookings.some((b) => b.id === bookingId)).toBe(true);

    const bList = await request(app).get('/api/bookings').set('Authorization', userB.authHeader);
    expect(bList.status).toBe(200);
    expect(bList.body.bookings.some((b) => b.id === bookingId)).toBe(false);
  });

  test('owner can access their own booking by ID (200)', async () => {
    const res = await request(app)
      .get(`/api/bookings/${bookingId}`)
      .set('Authorization', userA.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.booking.id).toBe(bookingId);
    expect(res.body.booking.userId).toBe(userA.userId);
  });

  test("another user cannot access someone else's booking by ID, and existence is not leaked (404)", async () => {
    const res = await request(app)
      .get(`/api/bookings/${bookingId}`)
      .set('Authorization', userB.authHeader);
    expect(res.status).toBe(404);

    // Same status/shape as a genuinely nonexistent booking -> no info leak.
    const missing = await request(app)
      .get(`/api/bookings/${crypto.randomUUID()}`)
      .set('Authorization', userB.authHeader);
    expect(missing.status).toBe(404);
    expect(res.body).toEqual(missing.body);
  });

  test('unauthenticated user cannot list bookings (401)', async () => {
    const res = await request(app).get('/api/bookings');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Cancelling bookings
// ---------------------------------------------------------------------------

describe('PATCH /api/bookings/:id/cancel', () => {
  test('a PENDING booking can be cancelled -> status becomes CANCELLED', async () => {
    const created = await createBooking(userA, { testId, centreId, appointmentDateTime: futureISO() });
    const id = created.body.booking.id;

    const res = await request(app)
      .patch(`/api/bookings/${id}/cancel`)
      .set('Authorization', userA.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('CANCELLED');

    const stored = await prisma.booking.findUnique({ where: { id } });
    expect(stored.status).toBe('CANCELLED');
  });

  test('an already CANCELLED booking cannot be cancelled again (400)', async () => {
    const created = await createBooking(userA, { testId, centreId, appointmentDateTime: futureISO() });
    const id = created.body.booking.id;

    const first = await request(app)
      .patch(`/api/bookings/${id}/cancel`)
      .set('Authorization', userA.authHeader);
    expect(first.status).toBe(200);

    const second = await request(app)
      .patch(`/api/bookings/${id}/cancel`)
      .set('Authorization', userA.authHeader);
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('BadRequest');
  });

  test('a FAILED booking cannot be cancelled (400)', async () => {
    const created = await createBooking(userA, { testId, centreId, appointmentDateTime: futureISO() });
    const id = created.body.booking.id;

    // No API creates a FAILED booking, so set the state directly for this scenario.
    await prisma.booking.update({ where: { id }, data: { status: 'FAILED' } });

    const res = await request(app)
      .patch(`/api/bookings/${id}/cancel`)
      .set('Authorization', userA.authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BadRequest');
  });

  test("cancelling another user's booking returns 404 (no ownership leak)", async () => {
    const created = await createBooking(userA, { testId, centreId, appointmentDateTime: futureISO() });
    const id = created.body.booking.id;

    const res = await request(app)
      .patch(`/api/bookings/${id}/cancel`)
      .set('Authorization', userB.authHeader);
    expect(res.status).toBe(404);

    // Booking must remain untouched (still PENDING) for the real owner.
    const stored = await prisma.booking.findUnique({ where: { id } });
    expect(stored.status).toBe('PENDING');
  });
});
