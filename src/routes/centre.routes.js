const express = require('express');

const authenticate = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { uuidParam } = require('../validators/common.validators');
const { createCentreSchema } = require('../validators/centre.validators');
const { createTestSchema } = require('../validators/test.validators');
const { createCentre, getCentres, getCentreById } = require('../controllers/centre.controller');
const { createTest, getTestsByCentre } = require('../controllers/test.controller');

const router = express.Router();

// Centres
router.post('/', authenticate, validate(createCentreSchema), createCentre);
router.get('/', getCentres);
router.get('/:id', validate(uuidParam('id'), 'params'), getCentreById);

// Tests nested under a centre
router.post(
  '/:centreId/tests',
  authenticate,
  validate(uuidParam('centreId'), 'params'),
  validate(createTestSchema),
  createTest
);
router.get('/:centreId/tests', validate(uuidParam('centreId'), 'params'), getTestsByCentre);

module.exports = router;
