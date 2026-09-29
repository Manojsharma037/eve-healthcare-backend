const { z } = require('zod');

// Builds a schema that validates a single UUID path parameter.
// Usage: validate(uuidParam('id'), 'params')
function uuidParam(field) {
  return z.object({
    [field]: z.string().uuid(`${field} must be a valid UUID`),
  });
}

module.exports = { uuidParam };
