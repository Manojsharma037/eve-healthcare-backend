const crypto = require('crypto');
const { BookingStatus } = require('@prisma/client');
const prisma = require('../prisma');

// POST /api/payments/webhook  (NO JWT — called by the payment provider)
//
// Idempotent: the same eventId is processed at most once. Repeated deliveries
// are acknowledged without creating duplicate payments or re-mutating booking
// state. The UNIQUE constraint on WebhookEvent.eventId is the final guard
// against concurrent duplicate deliveries.
async function handleWebhook(req, res, next) {
  try {
    const { eventId, bookingId, status } = req.body;

    // Fast path: this event was already processed -> idempotent acknowledgement.
    const existingEvent = await prisma.webhookEvent.findUnique({
      where: { eventId },
      select: { eventId: true },
    });
    if (existingEvent) {
      return res.status(200).json({ message: 'Webhook already processed', eventId });
    }

    // Load the booking. If it doesn't exist we must NOT mark the event as
    // processed (so a legitimate retry can still succeed later).
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, amount: true, status: true },
    });
    if (!booking) {
      return res.status(404).json({ error: 'NotFound', message: 'Booking not found' });
    }

    // A brand-new event may only act on a PENDING booking. Any terminal state
    // (CONFIRMED/FAILED/CANCELLED) is an invalid transition -> clean 400, and
    // the event is NOT marked processed.
    if (booking.status !== BookingStatus.PENDING) {
      // Concurrency: a duplicate delivery of THIS SAME event may have just
      // processed the booking. Because processing commits the WebhookEvent and
      // the booking update in one transaction, if the booking is now terminal
      // and this event already exists, it was our own duplicate -> acknowledge
      // idempotently instead of returning 400.
      const processed = await prisma.webhookEvent.findUnique({
        where: { eventId },
        select: { eventId: true },
      });
      if (processed) {
        return res.status(200).json({ message: 'Webhook already processed', eventId });
      }
      return res.status(400).json({
        error: 'BadRequest',
        message: `Booking cannot be processed because it is ${booking.status}`,
      });
    }

    // Derive everything server-side.
    const amount = booking.amount; // from DB, never the webhook body
    const transactionId = `txn_${crypto.randomUUID()}`;
    const isSuccess = status === 'SUCCESS';
    const newBookingStatus = isSuccess ? BookingStatus.CONFIRMED : BookingStatus.FAILED;

    // Atomic first-time processing: WebhookEvent + Payment + Booking update all
    // commit together, or all roll back. This guarantees the event is never
    // recorded as processed unless the business effects also persisted.
    let payment;
    let updatedBooking;
    try {
      const result = await prisma.$transaction([
        prisma.webhookEvent.create({ data: { eventId } }),
        prisma.payment.create({
          data: { bookingId, amount, status, transactionId },
          select: { id: true, bookingId: true, amount: true, status: true, transactionId: true },
        }),
        prisma.booking.update({
          where: { id: bookingId },
          data: { status: newBookingStatus },
          select: { id: true, status: true },
        }),
      ]);
      payment = result[1];
      updatedBooking = result[2];
    } catch (err) {
      // A concurrent duplicate may have won the race (or a payment already
      // exists for this booking). Prisma P2002 = unique-constraint violation.
      if (err && err.code === 'P2002') {
        // If the event now exists, another delivery processed it first ->
        // respond idempotently. Nothing was written by this (rolled-back) call.
        const nowExists = await prisma.webhookEvent.findUnique({
          where: { eventId },
          select: { eventId: true },
        });
        if (nowExists) {
          return res.status(200).json({ message: 'Webhook already processed', eventId });
        }
        // Otherwise the Payment.bookingId unique constraint tripped: this
        // booking already has a payment from another event.
        return res.status(409).json({
          error: 'Conflict',
          message: 'A payment already exists for this booking',
        });
      }
      throw err;
    }

    return res.status(200).json({
      message: 'Webhook processed successfully',
      eventId,
      payment,
      booking: updatedBooking,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { handleWebhook };
