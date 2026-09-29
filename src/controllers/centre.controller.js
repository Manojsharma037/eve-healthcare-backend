const prisma = require('../prisma');

// Fields safe to expose for a centre.
const centreSelect = {
  id: true,
  name: true,
  location: true,
  createdAt: true,
};

// POST /api/centres  (protected)
async function createCentre(req, res, next) {
  try {
    const { name, location } = req.body;

    const centre = await prisma.diagnosticCentre.create({
      data: { name, location },
      select: centreSelect,
    });

    return res.status(201).json({
      message: 'Diagnostic centre created successfully',
      centre,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/centres  (public)
async function getCentres(req, res, next) {
  try {
    const centres = await prisma.diagnosticCentre.findMany({
      select: centreSelect,
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ count: centres.length, centres });
  } catch (err) {
    next(err);
  }
}

// GET /api/centres/:id  (public) — centre + its tests
async function getCentreById(req, res, next) {
  try {
    const { id } = req.params;

    const centre = await prisma.diagnosticCentre.findUnique({
      where: { id },
      select: {
        ...centreSelect,
        tests: {
          select: { id: true, name: true, price: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!centre) {
      return res.status(404).json({ error: 'NotFound', message: 'Diagnostic centre not found' });
    }

    return res.status(200).json({ centre });
  } catch (err) {
    next(err);
  }
}

module.exports = { createCentre, getCentres, getCentreById };
