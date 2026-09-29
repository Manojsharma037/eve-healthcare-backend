const { z } = require('zod');

// POST /api/centres/:centreId/tests
// price: a positive monetary value with at most 2 decimal places.
// It is validated as a number here and stored as a Prisma Decimal
// (never floating-point) in the controller.
const createTestSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(150, 'Name is too long'),
  price: z
    .number({ message: 'Price must be a number' })
    .finite('Price must be a finite number')
    .positive('Price must be greater than 0')
    .max(9999999.99, 'Price is too large')
    .refine((v) => Math.round(v * 100) === v * 100, {
      message: 'Price can have at most 2 decimal places',
    }),
});

module.exports = { createTestSchema };
