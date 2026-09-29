const bcrypt = require('bcryptjs');
const prisma = require('../prisma');
const { signToken } = require('../utils/jwt');

// Cost factor for bcrypt. 10 is a sensible default (secure yet fast enough).
const SALT_ROUNDS = 10;

// A safe user projection — never includes the password hash.
const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
  updatedAt: true,
};

// POST /api/auth/signup
async function signup(req, res, next) {
  try {
    const { name, email, password } = req.body;

    // Reject duplicate emails with a clear 409.
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Email is already registered',
      });
    }

    // Hash the password; the plaintext is never stored or logged.
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: { name, email, password: passwordHash },
      select: publicUserSelect,
    });

    return res.status(201).json({
      message: 'User registered successfully',
      user,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    // Generic 401 for both "no such user" and "wrong password" so we never
    // reveal which part of the credentials was incorrect.
    const invalidCredentials = () =>
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });

    if (!user) {
      return invalidCredentials();
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return invalidCredentials();
    }

    const token = signToken({ userId: user.id });

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { signup, login };
