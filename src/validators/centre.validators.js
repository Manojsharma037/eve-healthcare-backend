const { z } = require('zod');

// POST /api/centres
const createCentreSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(150, 'Name is too long'),
  location: z.string().trim().min(1, 'Location is required').max(200, 'Location is too long'),
});

module.exports = { createCentreSchema };
