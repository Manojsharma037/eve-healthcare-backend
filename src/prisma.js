const { PrismaClient } = require('@prisma/client');

// Reuse a single PrismaClient instance across the app.
// A single shared client avoids exhausting the database connection pool
// (especially important with dev auto-reload / serverless environments).
const prisma = new PrismaClient();

module.exports = prisma;
