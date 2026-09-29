// 404 handler for unmatched routes.
function notFound(req, res, next) {
  res.status(404).json({
    error: 'NotFound',
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
}

// Centralized error handler. Keeps responses generic and never leaks
// stack traces, secrets or request bodies (which may contain passwords).
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Prisma unique-constraint violation (e.g. a race on duplicate email).
  if (err && err.code === 'P2002') {
    return res.status(409).json({
      error: 'Conflict',
      message: 'Email is already registered',
    });
  }

  // Log only the message, never the full error/body (avoids leaking secrets).
  console.error('[error]', err && err.message ? err.message : err);

  const status = err && err.status ? err.status : 500;
  return res.status(status).json({
    error: 'InternalServerError',
    message: 'Something went wrong',
  });
}

module.exports = { notFound, errorHandler };
