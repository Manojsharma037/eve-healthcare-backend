const express = require('express');

const { signup, login } = require('../controllers/auth.controller');
const validate = require('../middleware/validate.middleware');
const { signupSchema, loginSchema } = require('../validators/auth.validators');

const router = express.Router();

// POST /api/auth/signup
router.post('/signup', validate(signupSchema), signup);

// POST /api/auth/login
router.post('/login', validate(loginSchema), login);

module.exports = router;
