const express = require('express');

const authenticate = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { uuidParam } = require('../validators/common.validators');
const { createBookingSchema } = require('../validators/booking.validators');
const {
  createBooking,
  getBookings,
  getBookingById,
  cancelBooking,
} = require('../controllers/booking.controller');

const router = express.Router();

// All booking routes require authentication.
router.post('/', authenticate, validate(createBookingSchema), createBooking);
router.get('/', authenticate, getBookings);
router.get('/:id', authenticate, validate(uuidParam('id'), 'params'), getBookingById);
router.patch('/:id/cancel', authenticate, validate(uuidParam('id'), 'params'), cancelBooking);

module.exports = router;
