const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/prisma');
const { createUserAndToken, seedBooking } = require('./helpers/testUtils');

// Track created rows for FK-safe, targeted cleanup.
const userIds = [];
const centreIds = [];

// Register a seeded chain's ids for cleanup.
function trackSeed(seed) {
  userIds.push(seed.user.userId);
  centreIds.push(seed.centreId);
  return seed;
}

afterAll(async () => {
  // FK order (all relations onDelete: Restrict):
  // payments -> bookings -> tests -> centres -> users.
  await prisma.payment.deleteMany({ where: { booking: { userId: { in: userIds } } } });
  await prisma.booking.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.diagnosticTest.deleteMany({ where: { centreId: { in: centreIds } } });
  await prisma.diagnosticCentre.deleteMany({ where: { id: { in: centreIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

// Convenience: POST a payment as the seed's owner.
function pay(seed, body) {
  return request(app)
    .post('/api/payments')
    .set('Authorization', seed.user.authHeader)
    .send(body);
}

describe('POST /api/payments', () => {
  test('1/10. SUCCESS: booking CONFIRMED, exactly one Payment (SUCCESS), amount from DB, server txnId', async () => {
    const seed = trackSeed(await seedBooking(app, { price: 750.5 }));

    const res = await pay(seed, { bookingId: seed.bookingId, status: 'SUCCESS' });

    expect(res.status).toBe(200);
    expect(res.body.payment.status).toBe('SUCCESS');
    expect(res.body.booking.status).toBe('CONFIRMED');
    expect(Number(res.body.payment.amount)).toBe(seed.amount);
    expect(typeof res.body.payment.transactionId).toBe('string');
    expect(res.body.payment.transactionId).toMatch(/^txn_/);

    // Exactly one Payment row, matching the DB booking amount.
    const payments = await prisma.payment.findMany({ where: { bookingId: seed.bookingId } });
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('SUCCESS');
    expect(Number(payments[0].amount)).toBe(seed.amount);

    const booking = await prisma.booking.findUnique({ where: { id: seed.bookingId } });
    expect(booking.status).toBe('CONFIRMED');
  });

  test('2/11. FAILED: booking FAILED, exactly one Payment (FAILED)', async () => {
    const seed = trackSeed(await seedBooking(app));

    const res = await pay(seed, { bookingId: seed.bookingId, status: 'FAILED' });

    expect(res.status).toBe(200);
    expect(res.body.payment.status).toBe('FAILED');
    expect(res.body.booking.status).toBe('FAILED');

    const payments = await prisma.payment.findMany({ where: { bookingId: seed.bookingId } });
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('FAILED');

    const booking = await prisma.booking.findUnique({ where: { id: seed.bookingId } });
    expect(booking.status).toBe('FAILED');
  });

  test('3. unauthenticated request is rejected (401)', async () => {
    const seed = trackSeed(await seedBooking(app));
    const res = await request(app)
      .post('/api/payments')
      .send({ bookingId: seed.bookingId, status: 'SUCCESS' });
    expect(res.status).toBe(401);
  });

  test("4. a user cannot process another user's booking (404, no leak)", async () => {
    const seed = trackSeed(await seedBooking(app));
    const other = await createUserAndToken(app, { name: 'Other Payer' });
    userIds.push(other.userId);

    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', other.authHeader)
      .send({ bookingId: seed.bookingId, status: 'SUCCESS' });

    // Same 404 as a nonexistent booking -> existence of another user's booking
    // is not revealed.
    expect(res.status).toBe(404);

    // The victim's booking is untouched and no payment was created.
    const booking = await prisma.booking.findUnique({ where: { id: seed.bookingId } });
    expect(booking.status).toBe('PENDING');
    const count = await prisma.payment.count({ where: { bookingId: seed.bookingId } });
    expect(count).toBe(0);
  });

  test('5. client-supplied amount is ignored; persisted amount equals DB booking amount', async () => {
    const seed = trackSeed(await seedBooking(app, { price: 320.25 }));

    const res = await pay(seed, { bookingId: seed.bookingId, status: 'SUCCESS', amount: 1 });

    expect(res.status).toBe(200);
    expect(Number(res.body.payment.amount)).toBe(seed.amount);

    const payments = await prisma.payment.findMany({ where: { bookingId: seed.bookingId } });
    expect(Number(payments[0].amount)).toBe(seed.amount);
    expect(Number(payments[0].amount)).not.toBe(1);
  });

  test('6a. missing bookingId is rejected (400)', async () => {
    const seed = trackSeed(await seedBooking(app));
    const res = await pay(seed, { status: 'SUCCESS' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('6b. invalid bookingId UUID is rejected (400)', async () => {
    const seed = trackSeed(await seedBooking(app));
    const res = await pay(seed, { bookingId: 'not-a-uuid', status: 'SUCCESS' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('7. invalid payment status is rejected (400)', async () => {
    const seed = trackSeed(await seedBooking(app));
    const res = await pay(seed, { bookingId: seed.bookingId, status: 'REFUNDED' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('8. nonexistent booking returns 404', async () => {
    const seed = trackSeed(await seedBooking(app));
    const res = await pay(seed, { bookingId: crypto.randomUUID(), status: 'SUCCESS' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NotFound');
  });

  test('9a. a SUCCESS booking cannot be paid again (400)', async () => {
    const seed = trackSeed(await seedBooking(app));
    const first = await pay(seed, { bookingId: seed.bookingId, status: 'SUCCESS' });
    expect(first.status).toBe(200);

    const second = await pay(seed, { bookingId: seed.bookingId, status: 'SUCCESS' });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('BadRequest');

    // Still exactly one payment.
    const count = await prisma.payment.count({ where: { bookingId: seed.bookingId } });
    expect(count).toBe(1);
  });

  test('9b. a FAILED booking cannot be paid again (400)', async () => {
    const seed = trackSeed(await seedBooking(app));
    const first = await pay(seed, { bookingId: seed.bookingId, status: 'FAILED' });
    expect(first.status).toBe(200);

    const second = await pay(seed, { bookingId: seed.bookingId, status: 'SUCCESS' });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('BadRequest');

    const count = await prisma.payment.count({ where: { bookingId: seed.bookingId } });
    expect(count).toBe(1);
  });

  test('12. transaction rolls back on a real Payment unique-constraint conflict; booking stays PENDING', async () => {
    const seed = trackSeed(await seedBooking(app));

    // Controlled setup: inject a Payment for this still-PENDING booking directly,
    // so the API's transactional Payment.create hits the real Payment.bookingId
    // UNIQUE constraint (a genuine DB conflict — no mocking of Prisma).
    await prisma.payment.create({
      data: {
        bookingId: seed.bookingId,
        amount: seed.amount,
        status: 'SUCCESS',
        transactionId: `txn_seed_${crypto.randomUUID()}`,
      },
    });

    const res = await pay(seed, { bookingId: seed.bookingId, status: 'SUCCESS' });

    // The unique conflict aborts the transaction -> surfaced as a 4xx conflict.
    expect(res.status).toBeGreaterThanOrEqual(400);

    // Atomicity: the booking.update in the same transaction was rolled back, so
    // the booking remains PENDING, and no second Payment was created.
    const booking = await prisma.booking.findUnique({ where: { id: seed.bookingId } });
    expect(booking.status).toBe('PENDING');
    const count = await prisma.payment.count({ where: { bookingId: seed.bookingId } });
    expect(count).toBe(1);
  });
});
