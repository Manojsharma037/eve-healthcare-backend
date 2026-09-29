const { Prisma } = require('@prisma/client');
const prisma = require('../prisma');

// Fields safe to expose for a test.
const testSelect = {
  id: true,
  name: true,
  price: true,
  centreId: true,
  createdAt: true,
};

// POST /api/centres/:centreId/tests  (protected)
async function createTest(req, res, next) {
  try {
    const { centreId } = req.params;
    const { name, price } = req.body;

    // Ensure the centre exists first, so we return a clean 404 instead of
    // leaking a raw Prisma foreign-key error.
    const centre = await prisma.diagnosticCentre.findUnique({
      where: { id: centreId },
      select: { id: true },
    });

    if (!centre) {
      return res.status(404).json({ error: 'NotFound', message: 'Diagnostic centre not found' });
    }

    const test = await prisma.diagnosticTest.create({
      // Prisma.Decimal keeps money exact (no floating-point arithmetic).
      data: { name, price: new Prisma.Decimal(price), centreId },
      select: testSelect,
    });

    return res.status(201).json({
      message: 'Diagnostic test created successfully',
      test,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/centres/:centreId/tests  (public)
async function getTestsByCentre(req, res, next) {
  try {
    const { centreId } = req.params;

    const centre = await prisma.diagnosticCentre.findUnique({
      where: { id: centreId },
      select: { id: true },
    });

    if (!centre) {
      return res.status(404).json({ error: 'NotFound', message: 'Diagnostic centre not found' });
    }

    const tests = await prisma.diagnosticTest.findMany({
      where: { centreId },
      select: testSelect,
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ centreId, count: tests.length, tests });
  } catch (err) {
    next(err);
  }
}

// GET /api/tests/:id  (public) — test + its centre
async function getTestById(req, res, next) {
  try {
    const { id } = req.params;

    const test = await prisma.diagnosticTest.findUnique({
      where: { id },
      select: {
        ...testSelect,
        centre: { select: { id: true, name: true, location: true } },
      },
    });

    if (!test) {
      return res.status(404).json({ error: 'NotFound', message: 'Diagnostic test not found' });
    }

    return res.status(200).json({ test });
  } catch (err) {
    next(err);
  }
}

module.exports = { createTest, getTestsByCentre, getTestById };
