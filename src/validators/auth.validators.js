const { z } = require('zod');

// Signup payload validation.
// - name: required, trimmed, reasonable length
// - email: required, trimmed + lowercased so uniqueness is case-insensitive
// - password: 8..72 chars (bcrypt only uses the first 72 bytes)
const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  email: z.string().trim().toLowerCase().email('A valid email is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters'),
});

// Login payload validation. Password only needs to be present here;
// correctness is checked against the stored hash, not by Zod.
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

module.exports = { signupSchema, loginSchema };
