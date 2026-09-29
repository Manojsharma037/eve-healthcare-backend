const jwt = require('jsonwebtoken');

// Read the signing secret from the environment. Fail loudly if it's missing
// so we never accidentally sign tokens with an undefined/empty secret.
function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
}

// Sign a JWT for the given payload (e.g. { userId }).
function signToken(payload) {
  const expiresIn = process.env.JWT_EXPIRES_IN || '1d';
  return jwt.sign(payload, getSecret(), { expiresIn });
}

// Verify a JWT and return its decoded payload. Throws if invalid/expired.
function verifyToken(token) {
  return jwt.verify(token, getSecret());
}

module.exports = { signToken, verifyToken };
