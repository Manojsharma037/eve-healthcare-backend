const prisma = require('../prisma');
const { verifyToken } = require('../utils/jwt');

// JWT authentication middleware.
// Expects:  Authorization: Bearer <token>
// On success it attaches the authenticated user to req.user and calls next().
// On any failure it responds with a generic 401.
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or malformed Authorization header',
      });
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      // Covers invalid signature, malformed token and expired token.
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
    }

    // Load a fresh, safe view of the user (never the password hash).
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, name: true, email: true },
    });

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = authenticate;
