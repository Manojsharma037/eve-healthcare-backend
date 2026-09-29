const { BookingStatus } = require('@prisma/client');
const prisma = require('../prisma');

// Base fields safe to expose for a booking.
const bookingSelect = {
  id: true,
  userId: true,
  testId: true,
  centreId: true,
  appointmentDateTime: true,
  amount: true,
  status: true,
  createdAt: true,
  updatedAt: true,
};

// Booking + useful related test/centre info (no sensitive fields).
const bookingSelectWithRelations = {
  ...bookingSelect,
  test: { select: { id: true, name: true, price: true } },
  centre: { select: { id: true, name: true, location: true } },
};

// POST /api/bookings  (protected)
//
// Flow: JWT -> Zod -> get test -> get centre -> test belongs to centre
//       -> validate appointment time -> amount from DB -> create PENDING booking.
async function createBooking(req, res, next) {
  try {
    const userId = req.user.id; // identity from JWT, never from the body
    const { testId, centreId, appointmentDateTime } = req.body;

    // 1) Get Test
    const test = await prisma.diagnosticTest.findUnique({
      where: { id: testId },
      select: { id: true, price: true, centreId: true },
    });
    if (!test) {
      return res.status(404).json({ error: 'NotFound', message: 'Diagnostic test not found' });
    }

    // 2) Get Centre
    const centre = await prisma.diagnosticCentre.findUnique({
      where: { id: centreId },
      select: { id: true },
    });
    if (!centre) {
      return res.status(404).json({ error: 'NotFound', message: 'Diagnostic centre not found' });
    }

    // 3) The test must belong to the requested centre.
    if (test.centreId !== centreId) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'The selected test does not belong to the selected centre',
      });
    }

    // 4) Appointment must not be in the past.
    if (appointmentDateTime.getTime() <= Date.now()) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'appointmentDateTime must not be in the past',
      });
    }

    // 5) Amount is derived from the DB (the test's Decimal price), never the client.
    const amount = test.price;

    // 6) Create the booking in PENDING status.
    const booking = await prisma.booking.create({
      data: {
        userId,
        testId,
        centreId,
        appointmentDateTime,
        amount,
        status: BookingStatus.PENDING,
      },
      select: bookingSelect,
    });

    return res.status(201).json({
      message: 'Booking created successfully',
      booking,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/bookings  (protected) — only the authenticated user's bookings
async function getBookings(req, res, next) {
  try {
    const userId = req.user.id;

    const bookings = await prisma.booking.findMany({
      where: { userId },
      select: bookingSelectWithRelations,
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ count: bookings.length, bookings });
  } catch (err) {
    next(err);
  }
}

// GET /api/bookings/:id  (protected) — only if owned by the current user
async function getBookingById(req, res, next) {
  try {
    const { id } = req.params;

    // Scope by userId so another user's booking is indistinguishable from
    // a non-existent one (both -> 404, no information leak).
    const booking = await prisma.booking.findFirst({
      where: { id, userId: req.user.id },
      select: bookingSelectWithRelations,
    });

    if (!booking) {
      return res.status(404).json({ error: 'NotFound', message: 'Booking not found' });
    }

    return res.status(200).json({ booking });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/bookings/:id/cancel  (protected)
async function cancelBooking(req, res, next) {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findFirst({
      where: { id, userId: req.user.id },
      select: { id: true, status: true },
    });

    if (!booking) {
      return res.status(404).json({ error: 'NotFound', message: 'Booking not found' });
    }

    if (booking.status === BookingStatus.CANCELLED) {
      return res.status(400).json({ error: 'BadRequest', message: 'Booking is already cancelled' });
    }
    if (booking.status === BookingStatus.FAILED) {
      return res.status(400).json({ error: 'BadRequest', message: 'A failed booking cannot be cancelled' });
    }
    // Only PENDING and CONFIRMED bookings can be cancelled.
    if (booking.status !== BookingStatus.PENDING && booking.status !== BookingStatus.CONFIRMED) {
      return res.status(400).json({ error: 'BadRequest', message: 'Booking cannot be cancelled in its current state' });
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.CANCELLED },
      select: bookingSelect,
    });

    return res.status(200).json({
      message: 'Booking cancelled successfully',
      booking: updated,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { createBooking, getBookings, getBookingById, cancelBooking };
