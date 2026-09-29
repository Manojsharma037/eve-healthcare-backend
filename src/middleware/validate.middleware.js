// Reusable Zod validation middleware.
// Usage:
//   router.post('/signup', validate(signupSchema), controller)          // body (default)
//   router.get('/:id', validate(idParamSchema, 'params'), controller)   // path params
//
// On success it applies the parsed/normalized data (trimmed strings,
// lowercased email, etc.) back onto the request. On failure it returns 400.
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Invalid request data',
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    if (source === 'body') {
      // Replace the body entirely with the normalized data.
      req.body = result.data;
    } else {
      // For params/query, merge so we never drop other keys Express set.
      Object.assign(req[source], result.data);
    }

    next();
  };
}

module.exports = validate;
