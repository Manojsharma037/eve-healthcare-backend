const { z } = require('zod');

// POST /api/payments
// The client may only specify WHICH booking to pay for and the SIMULATED
// result. userId, amount and transactionId are never accepted from the client.
const createPaymentSchema = z.object({
  bookingId: z.string().uuid('bookingId must be a valid UUID'),
  status: z.enum(['SUCCESS', 'FAILED'], {
    message: 'status must be either SUCCESS or FAILED',
  }),
});

module.exports = { createPaymentSchema };
