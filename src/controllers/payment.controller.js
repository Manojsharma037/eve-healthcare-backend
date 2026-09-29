const crypto = require('crypto');
const { BookingStatus, PaymentStatus } = require('@prisma/client');
const prisma = require('../prisma');

// POST /api/payments  (protected)
//
// Simulated payment: the client says which booking and whether the (mock)
// payment SUCCEEDED or FAILED. Everything else is derived on the server.
async function createPayment(req, res, next) {
  try {
    const userId = req.user.id; // identity from JWT, never the body
    const { bookingId, status } = req.body;

    // Find the booking, scoped to the current user so another user's booking
    // is indistinguishable from a non-existent one (both -> 404).
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, userId },
      select: { id: true, amount: true, status: true },
    });

    if (!booking) {
      return res.status(404).json({ error: 'NotFound', message: 'Booking not found' });
    }

    // Payment may only be processed for a PENDING booking.
    if (booking.status !== BookingStatus.PENDING) {
      return res.status(400).json({
        error: 'BadRequest',
        message: `Booking cannot be paid because it is ${booking.status}`,
      });
    }

    // Amount comes from the stored booking amount (Decimal), never the client.
    const amount = booking.amount;

    // Backend-generated mock transaction id. Generated for both SUCCESS and
    // FAILED so every attempt has a traceable reference and the behavior is
    // uniform; the client can never supply its own.
    const transactionId = `txn_${crypto.randomUUID()}`;

    const isSuccess = status === PaymentStatus.SUCCESS;
    const newBookingStatus = isSuccess ? BookingStatus.CONFIRMED : BookingStatus.FAILED;

    // Payment creation + Booking update are one logical operation: run them in
    // a single transaction so they either both commit or both roll back.
    const [payment, updatedBooking] = await prisma.$transaction([
      prisma.payment.create({
        data: {
          bookingId: booking.id,
          amount,
          status,
          transactionId,
        },
        select: { id: true, bookingId: true, amount: true, status: true, transactionId: true },
      }),
      prisma.booking.update({
        where: { id: booking.id },
        data: { status: newBookingStatus },
        select: { id: true, status: true },
      }),
    ]);

    return res.status(200).json({
      message: isSuccess ? 'Payment processed successfully' : 'Payment failed',
      payment,
      booking: updatedBooking,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { createPayment };
