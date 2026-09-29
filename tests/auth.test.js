const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/prisma');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Every user this suite creates is tracked here so afterAll can remove ONLY
// the rows we created (targeted cleanup — never a truncate/reset).
const createdEmails = new Set();

function track(email) {
  // Stored emails are lowercased by the API's Zod schema, so track that form.
  createdEmails.add(email.toLowerCase());
  return email;
}

function uniqueEmail() {
  return track(`test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`);
}

const validPassword = 'Sup3rSecret!'; // 12 chars — satisfies the min-8 rule

// Sign up a fresh valid user through the real API and return useful bits.
async function signupUser(overrides = {}) {
  const email = overrides.email || uniqueEmail();
  const password = overrides.password || validPassword;
  const name = overrides.name || 'Test User';

  const res = await request(app).post('/api/auth/signup').send({ name, email, password });
  return { res, email, password, name };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  // Auth tests only create User rows (no bookings), so a targeted delete by the
  // exact set of emails we generated is sufficient and safe.
  if (createdEmails.size > 0) {
    await prisma.user.deleteMany({ where: { email: { in: [...createdEmails] } } });
  }
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

describe('POST /api/auth/signup', () => {
  test('1. successful signup returns 201, a safe user, and stores a bcrypt hash', async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Alice Example', email, password: validPassword });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.name).toBe('Alice Example');

    // No password / hash ever leaks in the response.
    expect(res.body.user.password).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(validPassword);

    // The user really exists in the TEST database.
    const stored = await prisma.user.findUnique({ where: { email } });
    expect(stored).not.toBeNull();

    // Stored password is a bcrypt hash, not plaintext.
    expect(stored.password).not.toBe(validPassword);
    expect(stored.password).toMatch(/^\$2[aby]\$/);
  });

  test('2. email is normalized to lowercase before storage', async () => {
    const lower = uniqueEmail(); // already lowercase and tracked
    const mixedCase = lower.toUpperCase(); // same address, different casing

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Case Test', email: mixedCase, password: validPassword });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(lower);

    const stored = await prisma.user.findUnique({ where: { email: lower } });
    expect(stored).not.toBeNull();
    expect(stored.email).toBe(lower);
  });

  test('3. duplicate email returns 409 and does not create a second user', async () => {
    const { email } = await signupUser();

    const dup = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Dup User', email, password: validPassword });

    expect(dup.status).toBe(409);

    const count = await prisma.user.count({ where: { email } });
    expect(count).toBe(1);
  });

  test('4. malformed email returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Bad Email', email: 'not-an-email', password: validPassword });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('5. password shorter than the min (8) returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Short Pw', email: uniqueEmail(), password: 'short7!' }); // 7 chars

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  test('6. missing a required field (password) returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'No Pw', email: uniqueEmail() });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  test('7. successful login returns 200 and a JWT', async () => {
    const { email, password } = await signupUser();

    const res = await request(app).post('/api/auth/login').send({ email, password });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.password).toBeUndefined();
  });

  test('8. wrong password returns a generic 401 that does not reveal the reason', async () => {
    const { email } = await signupUser();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'totallyWrongPassword!' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  test('9. unknown email returns the same generic 401 as a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: `nobody-${Date.now()}@example.com`, password: validPassword });

    expect(res.status).toBe(401);
    // Identical to the wrong-password response — no user-enumeration leak.
    expect(res.body.message).toBe('Invalid email or password');
  });

  test('10. missing a login field (password) returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: uniqueEmail() });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });
});

// ---------------------------------------------------------------------------
// Protected route: GET /api/bookings
// ---------------------------------------------------------------------------

describe('Protected route GET /api/bookings', () => {
  test('11. no token returns 401', async () => {
    const res = await request(app).get('/api/bookings');
    expect(res.status).toBe(401);
  });

  test('12. malformed Authorization header returns 401', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', 'NotBearer sometoken');
    expect(res.status).toBe(401);
  });

  test('13. invalid JWT returns 401', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', 'Bearer this.is.not.a.valid.jwt');
    expect(res.status).toBe(401);
  });

  test('13b. expired JWT returns 401', async () => {
    // Build an already-expired token with the SAME secret the app verifies
    // against — no production code or global expiry is changed.
    const { email } = await signupUser();
    const user = await prisma.user.findUnique({ where: { email } });
    const expired = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '-1s' });

    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  test('14. valid JWT is accepted and identifies the correct user', async () => {
    const { email, password } = await signupUser();

    const login = await request(app).post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    const { token } = login.body;

    // The token really encodes this user's id (identity check).
    const created = await prisma.user.findUnique({ where: { email } });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.userId).toBe(created.id);

    // The protected route accepts the token and returns this user's (empty) list.
    const res = await request(app).get('/api/bookings').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(Array.isArray(res.body.bookings)).toBe(true);
    expect(res.body.bookings).toHaveLength(0);
  });
});
