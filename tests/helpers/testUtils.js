const request = require('supertest');

// Shared test utilities used by centres.test.js and bookings.test.js.
// Kept tiny and focused: unique data generators + one "create an authenticated
// user" helper, so each suite doesn't duplicate signup/login boilerplate.

const DEFAULT_PASSWORD = 'Sup3rSecret!'; // satisfies the min-8 signup rule

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function uniqueEmail() {
  return `test-${uniqueSuffix()}@example.com`;
}

function uniqueName(prefix = 'Test') {
  return `${prefix} ${uniqueSuffix()}`;
}

// Signs up + logs in a fresh user through the real API and returns the JWT and
// identity. The caller is responsible for tracking the returned userId for
// cleanup.
async function createUserAndToken(app, { name = 'Test User' } = {}) {
  const email = uniqueEmail();
  const password = DEFAULT_PASSWORD;

  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ name, email, password });
  if (signup.status !== 201) {
    throw new Error(`Test setup: signup failed with ${signup.status}`);
  }

  const login = await request(app).post('/api/auth/login').send({ email, password });
  if (login.status !== 200) {
    throw new Error(`Test setup: login failed with ${login.status}`);
  }

  return {
    email,
    password,
    token: login.body.token,
    userId: login.body.user.id,
    authHeader: `Bearer ${login.body.token}`,
  };
}

// Seeds a full, ready-to-pay chain through the real API: a fresh authenticated
// user -> a centre -> a diagnostic test (known price) -> a PENDING booking.
// Returns the identity + ids + amount so payment/webhook suites can drive
// payment flows without repeating this boilerplate. The caller tracks the
// returned userId/centreId for cleanup.
async function seedBooking(app, { price = 499.99, userName = 'Payer', daysAhead = 7 } = {}) {
  const user = await createUserAndToken(app, { name: userName });

  const centreRes = await request(app)
    .post('/api/centres')
    .set('Authorization', user.authHeader)
    .send({ name: uniqueName('Centre'), location: 'Test City' });
  const centreId = centreRes.body.centre.id;

  const testRes = await request(app)
    .post(`/api/centres/${centreId}/tests`)
    .set('Authorization', user.authHeader)
    .send({ name: uniqueName('Test'), price });
  const testId = testRes.body.test.id;

  const appointmentDateTime = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
  const bookingRes = await request(app)
    .post('/api/bookings')
    .set('Authorization', user.authHeader)
    .send({ testId, centreId, appointmentDateTime });
  const bookingId = bookingRes.body.booking.id;
  const amount = Number(bookingRes.body.booking.amount);

  return { user, centreId, testId, bookingId, amount };
}

module.exports = {
  DEFAULT_PASSWORD,
  uniqueSuffix,
  uniqueEmail,
  uniqueName,
  createUserAndToken,
  seedBooking,
};
