const { z } = require('zod');

// POST /api/bookings
// - testId / centreId: valid UUIDs
// - appointmentDateTime: a parseable date-time (coerced to a Date object).
//   The "must be in the future" business rule is enforced in the controller,
//   after the test/centre existence checks (per the required flow).
// Note: `amount` is intentionally NOT accepted from the client — it is always
// derived from the test's price in the database.
const createBookingSchema = z.object({
  testId: z.string().uuid('testId must be a valid UUID'),
  centreId: z.string().uuid('centreId must be a valid UUID'),
  appointmentDateTime: z.coerce.date({
    message: 'appointmentDateTime must be a valid ISO 8601 date-time',
  }),
});

module.exports = { createBookingSchema };
