const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/prisma');
const { uniqueSuffix, seedBooking } = require('./helpers/testUtils');

// Track created rows for FK-safe, targeted cleanup.
const userIds = [];
const centreIds = [];
const eventIds = [];

function trackSeed(seed) {
  userIds.push(seed.user.userId);
  centreIds.push(seed.centreId);
  return seed;
}

function uniqueEventId() {
  const id = `evt-${uniqueSuffix()}`;
  eventIds.push(id);
  return id;
}

function sendWebhook(body) {
  return request(app).post('/api/payments/webhook').send(body);
}

afterAll(async () => {
  // FK order: payments -> bookings -> tests -> centres -> users.
  // WebhookEvent has no FK; remove by the exact eventIds we created.
  await prisma.payment.deleteMany({ where: { booking: { userId: { in: userIds } } } });
  await prisma.booking.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.diagnosticTest.deleteMany({ where: { centreId: { in: centreIds } } });
  await prisma.diagnosticCentre.deleteMany({ where: { id: { in: centreIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.webhookEvent.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.$disconnect();
});

describe('POST /api/payments/webhook', () => {
  test('1. valid SUCCESS webhook: event + payment created, booking CONFIRMED, amount from DB', async () => {
    const seed = trackSeed(await seedBooking(app, { price: 640.4 }));
    const eventId = uniqueEventId();

    const res = await sendWebhook({ eventId, bookingId: seed.bookingId, status: 'SUCCESS' });

    expect(res.status).toBe(200);
    expect(res.body.payment.status).toBe('SUCCESS');
    expect(res.body.booking.status).toBe('CONFIRMED');
    expect(Number(res.body.payment.amount)).toBe(seed.amount);
    expect(res.body.payment.transactionId).toMatch(/^txn_/);

    const event = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect(event).not.toBeNull();

    const payments = await prisma.payment.findMany({ where: { bookingId: seed.bookingId } });
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('SUCCESS');
    expect(Number(payments[0].amount)).toBe(seed.amount);

    const booking = await prisma.booking.findUnique({ where: { id: seed.bookingId } });
    expect(booking.status).toBe('CONFIRMED');
  });

  test('2. valid FAILED webhook: event created, payment FAILED, booking FAILED', async () => {
    const seed = trackSeed(await seedBooking(app));
    const eventId = uniqueEventId();

    const res = await sendWebhook({ eventId, bookingId: seed.bookingId, status: 'FAILED' });

    expect(res.status).toBe(200);
    expect(res.body.payment.status).toBe('FAILED');
    expect(res.body.booking.status).toBe('FAILED');

    const event = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect(event).not.toBeNull();
    const booking = await prisma.booking.findUnique({ where: { id: seed.bookingId } });
    expect(booking.status).toBe('FAILED');
  });

  test('3/13. duplicate delivery of the SAME eventId is idempotent (one event, one payment)', async () => {
    const seed = trackSeed(await seedBooking(app));
    const eventId = uniqueEventId();

    const first = await sendWebhook({ eventId, bookingId: seed.bookingId, status: 'SUCCESS' });
    expect(first.status).toBe(200);

    const second = await sendWebhook({ eventId, bookingId: seed.bookingId, status: 'SUCCESS' });
    expect(second.status).toBe(200); // idempotent acknowledgement

    // DB-enforced uniqueness: exactly one WebhookEvent and one Payment.
    const eventCount = await prisma.webhookEvent.count({ where: { eventId } });
    expect(eventCount).toBe(1);
    const paymentCount = await prisma.payment.count({ where: { bookingId: seed.bookingId } });
    expect(paymentCount).toBe(1);

    const booking = await prisma.booking.findUnique({ where: { id: seed.bookingId } });
    expect(booking.status).toBe('CONFIRMED');
  });

  test('4. concurrent duplicate deliveries (same eventId) create exactly one event and one payment', async () => {
    const seed = trackSeed(await seedBooking(app));
    const eventId = uniqueEventId();
    const payload = { eventId, bookingId: seed.bookingId, status: 'SUCCESS' };

    const [r1, r2] = await Promise.all([sendWebhook(payload), sendWebhook(payload)]);

    // Both handled without error per the idempotency design.
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const eventCount = await prisma.webhookEvent.count({ where: { eventId } });
    expect(eventCount).toBe(1);
    const paymentCount = await prisma.payment.count({ where: { bookingId: seed.bookingId } });
    expect(paymentCount).toBe(1);

    const booking = await prisma.booking.findUnique({ where: { id: seed.bookingId } });
    expect(booking.status).toBe('CONFIRMED');
  });

  test('5. a DIFFERENT eventId on an already-terminal booking is rejected (400), no new rows', async () => {
    const seed = trackSeed(await seedBooking(app));
    const firstEventId = uniqueEventId();

    const first = await sendWebhook({ eventId: firstEventId, bookingId: seed.bookingId, status: 'SUCCESS' });
    expect(first.status).toBe(200);

    const secondEventId = uniqueEventId();
    const second = await sendWebhook({ eventId: secondEventId, bookingId: seed.bookingId, status: 'SUCCESS' });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('BadRequest');

    // The second (new) event was NOT recorded and created no extra payment.
    const secondEvent = await prisma.webhookEvent.findUnique({ where: { eventId: secondEventId } });
    expect(secondEvent).toBeNull();
    const paymentCount = await prisma.payment.count({ where: { bookingId: seed.bookingId } });
    expect(paymentCount).toBe(1);

    const booking = await prisma.booking.findUnique({ where: { id: seed.bookingId } });
    expect(booking.status).toBe('CONFIRMED');
  });

  test('6. nonexistent booking returns 404 and does not record the event', async () => {
    const eventId = uniqueEventId();
    const res = await sendWebhook({ eventId, bookingId: crypto.randomUUID(), status: 'SUCCESS' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NotFound');

    const event = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect(event).toBeNull();
  });

  test('7. invalid booking UUID is rejected (400)', async () => {
    const res = await sendWebhook({ eventId: uniqueEventId(), bookingId: 'not-a-uuid', status: 'SUCCESS' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('8. missing eventId is rejected (400)', async () => {
    const seed = trackSeed(await seedBooking(app));
    const res = await sendWebhook({ bookingId: seed.bookingId, status: 'SUCCESS' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('9. empty/whitespace eventId is rejected (400)', async () => {
    const seed = trackSeed(await seedBooking(app));
    const res = await sendWebhook({ eventId: '   ', bookingId: seed.bookingId, status: 'SUCCESS' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('10. invalid payment status is rejected (400)', async () => {
    const seed = trackSeed(await seedBooking(app));
    const res = await sendWebhook({ eventId: uniqueEventId(), bookingId: seed.bookingId, status: 'PENDING' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('11. missing required fields (bookingId + status) is rejected (400)', async () => {
    const res = await sendWebhook({ eventId: uniqueEventId() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('12. client cannot control the amount; payment amount comes from the booking', async () => {
    const seed = trackSeed(await seedBooking(app, { price: 199.99 }));
    const eventId = uniqueEventId();

    const res = await sendWebhook({
      eventId,
      bookingId: seed.bookingId,
      status: 'SUCCESS',
      amount: 1, // must be ignored
    });

    expect(res.status).toBe(200);
    expect(Number(res.body.payment.amount)).toBe(seed.amount);

    const payments = await prisma.payment.findMany({ where: { bookingId: seed.bookingId } });
    expect(Number(payments[0].amount)).toBe(seed.amount);
    expect(Number(payments[0].amount)).not.toBe(1);
  });

  test('14. transaction rolls back on a real Payment unique-constraint conflict; event NOT recorded', async () => {
    const seed = trackSeed(await seedBooking(app));

    // Controlled setup: inject a Payment for this still-PENDING booking, so the
    // webhook's transactional Payment.create hits the real Payment.bookingId
    // UNIQUE constraint (genuine DB conflict — no Prisma mocking).
    await prisma.payment.create({
      data: {
        bookingId: seed.bookingId,
        amount: seed.amount,
        status: 'SUCCESS',
        transactionId: `txn_seed_${crypto.randomUUID()}`,
      },
    });

    const eventId = uniqueEventId();
    const res = await sendWebhook({ eventId, bookingId: seed.bookingId, status: 'SUCCESS' });

    // Explicit handler: the conflicting booking payment surfaces as 409.
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Conflict');

    // Atomicity: the WebhookEvent.create in the same transaction rolled back,
    // so this event was NOT recorded, and no second Payment exists.
    const event = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect(event).toBeNull();
    const paymentCount = await prisma.payment.count({ where: { bookingId: seed.bookingId } });
    expect(paymentCount).toBe(1);

    // Booking stays PENDING (its update rolled back too).
    const booking = await prisma.booking.findUnique({ where: { id: seed.bookingId } });
    expect(booking.status).toBe('PENDING');
  });
});
