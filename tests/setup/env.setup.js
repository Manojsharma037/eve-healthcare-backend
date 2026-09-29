/**
 * Jest setup — runs (via `setupFiles` in jest.config.js) before any test module
 * is loaded, i.e. before src/prisma.js instantiates PrismaClient.
 *
 * Responsibility: make the test suite talk ONLY to the dedicated test database.
 *
 * How it works:
 *   - Loads .env (which holds DATABASE_URL for dev and TEST_DATABASE_URL for tests).
 *   - Optionally loads a git-ignored .env.test for overrides, if present.
 *   - Overrides process.env.DATABASE_URL with TEST_DATABASE_URL so that
 *     src/prisma.js (which reads DATABASE_URL) connects to eve_healthcare_test.
 *
 * Development is unaffected: `npm run dev` / `npm start` never load this file,
 * so they keep using DATABASE_URL as configured in .env.
 */
const path = require('path');
const dotenv = require('dotenv');

// Base env (dev DATABASE_URL + TEST_DATABASE_URL). `quiet` suppresses dotenv's
// informational startup tips so test output stays clean.
dotenv.config({ quiet: true });
// Optional per-machine overrides for tests (git-ignored, may not exist).
dotenv.config({ path: path.resolve(process.cwd(), '.env.test'), override: true, quiet: true });

const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Copy .env.test.example and set it to your ' +
      'eve_healthcare_test connection string before running the tests.'
  );
}

// Safety guard: the test DB name must be eve_healthcare_test, never the dev DB.
// This prevents the suite from ever running against development data by mistake.
const targetsTestDb = /\/eve_healthcare_test(\?|$)/.test(testUrl);
if (!targetsTestDb) {
  throw new Error(
    'Refusing to run tests: TEST_DATABASE_URL does not point at the ' +
      '"eve_healthcare_test" database. Aborting to protect the development database.'
  );
}

// Point Prisma (src/prisma.js reads env("DATABASE_URL")) at the test database.
process.env.DATABASE_URL = testUrl;
