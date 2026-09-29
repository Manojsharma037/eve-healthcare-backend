/**
 * Jest configuration for the EVE Healthcare Backend.
 *
 * The project is plain CommonJS Node.js, so no transform/Babel is needed —
 * Jest runs the source files as-is.
 */
module.exports = {
  // Run tests in a Node.js environment (no jsdom / browser globals).
  testEnvironment: 'node',

  // Only treat files under tests/ as test suites.
  testMatch: ['**/tests/**/*.test.js'],

  // Runs before each test file (and before any module imports PrismaClient),
  // pointing Prisma at the dedicated test database. See tests/setup/env.setup.js.
  setupFiles: ['<rootDir>/tests/setup/env.setup.js'],

  // Keep output readable while the suite is small.
  verbose: true,
};
