const { z } = require('zod');

// POST /api/payments/webhook
// Only eventId, bookingId and status are accepted. userId, amount and
// transactionId are never taken from the webhook body — amount is derived
// from the booking and transactionId is generated on the backend.
const webhookSchema = z.object({
  eventId: z.string().trim().min(1, 'eventId is required').max(255, 'eventId is too long'),
  bookingId: z.string().uuid('bookingId must be a valid UUID'),
  status: z.enum(['SUCCESS', 'FAILED'], {
    message: 'status must be either SUCCESS or FAILED',
  }),
});

module.exports = { webhookSchema };
