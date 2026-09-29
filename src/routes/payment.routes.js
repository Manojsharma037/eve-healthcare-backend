const express = require('express');

const authenticate = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { createPaymentSchema } = require('../validators/payment.validators');
const { webhookSchema } = require('../validators/webhook.validators');
const { createPayment } = require('../controllers/payment.controller');
const { handleWebhook } = require('../controllers/webhook.controller');

const router = express.Router();

// POST /api/payments  (protected — the logged-in patient's mock payment)
router.post('/', authenticate, validate(createPaymentSchema), createPayment);

// POST /api/payments/webhook  (NO JWT — simulated payment provider callback)
router.post('/webhook', validate(webhookSchema), handleWebhook);

module.exports = router;
