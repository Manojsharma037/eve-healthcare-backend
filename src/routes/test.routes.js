const express = require('express');

const validate = require('../middleware/validate.middleware');
const { uuidParam } = require('../validators/common.validators');
const { getTestById } = require('../controllers/test.controller');

const router = express.Router();

// GET /api/tests/:id  (public)
router.get('/:id', validate(uuidParam('id'), 'params'), getTestById);

module.exports = router;
