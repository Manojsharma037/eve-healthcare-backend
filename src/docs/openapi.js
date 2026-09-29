// OpenAPI 3.0 specification for the EVE Healthcare Backend.
//
// This is hand-written to match the ACTUAL implementation (routes, Zod
// validators and controller responses) rather than generated from code, so it
// stays a single maintainable source of truth without scattering large Swagger
// comments across controllers.
//
// Notes on representation (kept faithful to the real API):
// - IDs are UUID strings.
// - `price`/`amount` are stored as Prisma Decimal and therefore serialized as
//   decimal *strings* in responses (e.g. "499.99"). The test-creation request
//   accepts `price` as a JSON *number* (validated by Zod).

const bookingStatusValues = ['PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED'];
const paymentStatusValues = ['SUCCESS', 'FAILED'];

// Reusable response wrappers ------------------------------------------------

const jsonContent = (schemaRef) => ({
  content: { 'application/json': { schema: schemaRef } },
});

const errorResponse = (description) => ({
  description,
  ...jsonContent({ $ref: '#/components/schemas/Error' }),
});

const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'EVE Healthcare Backend API',
    version: '1.0.0',
    description:
      'REST API for booking diagnostic tests at diagnostic centres and processing ' +
      'simulated payments. Identity is derived from JWTs (never the request body); ' +
      'money uses fixed-precision decimals; multi-step operations are transactional. ' +
      'The payment webhook is idempotent and intentionally does NOT use user JWT auth.',
  },
  servers: [{ url: '/', description: 'Current host' }],
  tags: [
    { name: 'Health', description: 'Service health check' },
    { name: 'Auth', description: 'User registration and login' },
    { name: 'Centres', description: 'Diagnostic centres' },
    { name: 'Tests', description: 'Diagnostic tests offered by centres' },
    { name: 'Bookings', description: 'Test bookings (per authenticated user)' },
    { name: 'Payments', description: 'Mock payment processing' },
    { name: 'Webhook', description: 'Payment-provider callback (no user JWT)' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Send the JWT from POST /api/auth/login as: Authorization: Bearer <token>',
      },
    },
    schemas: {
      // --- Shared / errors ---
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'ValidationError' },
          message: { type: 'string', example: 'Invalid request data' },
          details: {
            type: 'array',
            description: 'Present on validation errors only.',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string', example: 'email' },
                message: { type: 'string', example: 'A valid email is required' },
              },
            },
          },
        },
      },
      BookingStatus: { type: 'string', enum: bookingStatusValues },
      PaymentStatus: { type: 'string', enum: paymentStatusValues },

      // --- Entities ---
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Alice Example' },
          email: { type: 'string', format: 'email', example: 'alice@example.com' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      DiagnosticCentre: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'City Diagnostics' },
          location: { type: 'string', example: 'Bengaluru' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      DiagnosticTest: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Complete Blood Count' },
          price: {
            type: 'string',
            description: 'Decimal string (money), e.g. "499.99".',
            example: '499.99',
          },
          centreId: { type: 'string', format: 'uuid' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Booking: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          userId: { type: 'string', format: 'uuid' },
          testId: { type: 'string', format: 'uuid' },
          centreId: { type: 'string', format: 'uuid' },
          appointmentDateTime: { type: 'string', format: 'date-time' },
          amount: { type: 'string', description: 'Decimal string (money).', example: '499.99' },
          status: { $ref: '#/components/schemas/BookingStatus' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Payment: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          bookingId: { type: 'string', format: 'uuid' },
          amount: { type: 'string', description: 'Decimal string (money).', example: '499.99' },
          status: { $ref: '#/components/schemas/PaymentStatus' },
          transactionId: {
            type: 'string',
            description: 'Server-generated mock reference.',
            example: 'txn_2b1c...e9',
          },
        },
      },
      WebhookEvent: {
        type: 'object',
        description: 'Idempotency record keyed by the provider event id.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          eventId: { type: 'string', example: 'evt_12345' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },

      // --- Request bodies ---
      SignupRequest: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100, example: 'Alice Example' },
          email: { type: 'string', format: 'email', example: 'alice@example.com' },
          password: {
            type: 'string',
            minLength: 8,
            maxLength: 72,
            description: 'Stored as a bcrypt hash; never returned.',
            example: 'Sup3rSecret!',
          },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'alice@example.com' },
          password: { type: 'string', minLength: 1, example: 'Sup3rSecret!' },
        },
      },
      CreateCentreRequest: {
        type: 'object',
        required: ['name', 'location'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 150, example: 'City Diagnostics' },
          location: { type: 'string', minLength: 1, maxLength: 200, example: 'Bengaluru' },
        },
      },
      CreateTestRequest: {
        type: 'object',
        required: ['name', 'price'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 150, example: 'Complete Blood Count' },
          price: {
            type: 'number',
            description: 'Positive, at most 2 decimal places, max 9999999.99.',
            minimum: 0.01,
            maximum: 9999999.99,
            example: 499.99,
          },
        },
      },
      BookingRequest: {
        type: 'object',
        required: ['testId', 'centreId', 'appointmentDateTime'],
        description:
          'amount and userId are NOT accepted; amount is derived from the test price and ' +
          'identity comes from the JWT.',
        properties: {
          testId: { type: 'string', format: 'uuid' },
          centreId: { type: 'string', format: 'uuid' },
          appointmentDateTime: {
            type: 'string',
            format: 'date-time',
            description: 'ISO 8601. Must be in the future.',
            example: '2030-01-01T10:00:00.000Z',
          },
        },
      },
      PaymentRequest: {
        type: 'object',
        required: ['bookingId', 'status'],
        description: 'amount and transactionId are never accepted from the client.',
        properties: {
          bookingId: { type: 'string', format: 'uuid' },
          status: { $ref: '#/components/schemas/PaymentStatus' },
        },
      },
      WebhookRequest: {
        type: 'object',
        required: ['eventId', 'bookingId', 'status'],
        properties: {
          eventId: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            description: 'Provider idempotency key.',
            example: 'evt_12345',
          },
          bookingId: { type: 'string', format: 'uuid' },
          status: { $ref: '#/components/schemas/PaymentStatus' },
        },
      },
    },
  },

  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Service health check',
        security: [],
        responses: {
          200: {
            description: 'Service is up.',
            ...jsonContent({
              type: 'object',
              properties: {
                status: { type: 'string', example: 'ok' },
                service: { type: 'string', example: 'EVE Healthcare Backend' },
              },
            }),
          },
        },
      },
    },

    '/api/auth/signup': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        description: 'Email is normalized to lowercase; password is bcrypt-hashed and never returned.',
        security: [],
        requestBody: {
          required: true,
          ...jsonContent({ $ref: '#/components/schemas/SignupRequest' }),
        },
        responses: {
          201: {
            description: 'User created.',
            ...jsonContent({
              type: 'object',
              properties: {
                message: { type: 'string', example: 'User registered successfully' },
                user: { $ref: '#/components/schemas/User' },
              },
            }),
          },
          400: errorResponse('Validation error.'),
          409: errorResponse('Email already registered.'),
        },
      },
    },

    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in and receive a JWT',
        security: [],
        requestBody: {
          required: true,
          ...jsonContent({ $ref: '#/components/schemas/LoginRequest' }),
        },
        responses: {
          200: {
            description: 'Authenticated.',
            ...jsonContent({
              type: 'object',
              properties: {
                message: { type: 'string', example: 'Login successful' },
                token: { type: 'string', description: 'JWT bearer token.' },
                user: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    name: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                  },
                },
              },
            }),
          },
          400: errorResponse('Validation error.'),
          401: errorResponse('Invalid email or password (generic, no user enumeration).'),
        },
      },
    },

    '/api/centres': {
      post: {
        tags: ['Centres'],
        summary: 'Create a diagnostic centre',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          ...jsonContent({ $ref: '#/components/schemas/CreateCentreRequest' }),
        },
        responses: {
          201: {
            description: 'Centre created.',
            ...jsonContent({
              type: 'object',
              properties: {
                message: { type: 'string' },
                centre: { $ref: '#/components/schemas/DiagnosticCentre' },
              },
            }),
          },
          400: errorResponse('Validation error.'),
          401: errorResponse('Missing or invalid token.'),
        },
      },
      get: {
        tags: ['Centres'],
        summary: 'List all diagnostic centres',
        security: [],
        responses: {
          200: {
            description: 'List of centres.',
            ...jsonContent({
              type: 'object',
              properties: {
                count: { type: 'integer', example: 2 },
                centres: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/DiagnosticCentre' },
                },
              },
            }),
          },
        },
      },
    },

    '/api/centres/{id}': {
      get: {
        tags: ['Centres'],
        summary: 'Get a centre by ID (with its tests)',
        security: [],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: 'Centre with nested tests.',
            ...jsonContent({
              type: 'object',
              properties: {
                centre: {
                  allOf: [
                    { $ref: '#/components/schemas/DiagnosticCentre' },
                    {
                      type: 'object',
                      properties: {
                        tests: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'string', format: 'uuid' },
                              name: { type: 'string' },
                              price: { type: 'string', example: '499.99' },
                              createdAt: { type: 'string', format: 'date-time' },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            }),
          },
          400: errorResponse('Invalid UUID.'),
          404: errorResponse('Centre not found.'),
        },
      },
    },

    '/api/centres/{centreId}/tests': {
      post: {
        tags: ['Tests'],
        summary: 'Create a diagnostic test under a centre',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'centreId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          ...jsonContent({ $ref: '#/components/schemas/CreateTestRequest' }),
        },
        responses: {
          201: {
            description: 'Test created.',
            ...jsonContent({
              type: 'object',
              properties: {
                message: { type: 'string' },
                test: { $ref: '#/components/schemas/DiagnosticTest' },
              },
            }),
          },
          400: errorResponse('Validation error (including invalid centreId UUID).'),
          401: errorResponse('Missing or invalid token.'),
          404: errorResponse('Centre not found.'),
        },
      },
      get: {
        tags: ['Tests'],
        summary: 'List tests for a centre',
        security: [],
        parameters: [
          {
            name: 'centreId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: 'Tests for the centre.',
            ...jsonContent({
              type: 'object',
              properties: {
                centreId: { type: 'string', format: 'uuid' },
                count: { type: 'integer' },
                tests: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/DiagnosticTest' },
                },
              },
            }),
          },
          400: errorResponse('Invalid UUID.'),
          404: errorResponse('Centre not found.'),
        },
      },
    },

    '/api/tests/{id}': {
      get: {
        tags: ['Tests'],
        summary: 'Get a test by ID (with its centre)',
        security: [],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: 'Test with nested centre.',
            ...jsonContent({
              type: 'object',
              properties: {
                test: {
                  allOf: [
                    { $ref: '#/components/schemas/DiagnosticTest' },
                    {
                      type: 'object',
                      properties: {
                        centre: {
                          type: 'object',
                          properties: {
                            id: { type: 'string', format: 'uuid' },
                            name: { type: 'string' },
                            location: { type: 'string' },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            }),
          },
          400: errorResponse('Invalid UUID.'),
          404: errorResponse('Test not found.'),
        },
      },
    },

    '/api/bookings': {
      post: {
        tags: ['Bookings'],
        summary: 'Create a booking',
        description:
          'Amount is derived from the test price; the booking starts in PENDING. ' +
          'Identity comes from the JWT.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          ...jsonContent({ $ref: '#/components/schemas/BookingRequest' }),
        },
        responses: {
          201: {
            description: 'Booking created (PENDING).',
            ...jsonContent({
              type: 'object',
              properties: {
                message: { type: 'string' },
                booking: { $ref: '#/components/schemas/Booking' },
              },
            }),
          },
          400: errorResponse('Validation error, test/centre mismatch, or past appointment.'),
          401: errorResponse('Missing or invalid token.'),
          404: errorResponse('Test or centre not found.'),
        },
      },
      get: {
        tags: ['Bookings'],
        summary: "List the authenticated user's bookings",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Only the current user\'s bookings.',
            ...jsonContent({
              type: 'object',
              properties: {
                count: { type: 'integer' },
                bookings: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Booking' },
                },
              },
            }),
          },
          401: errorResponse('Missing or invalid token.'),
        },
      },
    },

    '/api/bookings/{id}': {
      get: {
        tags: ['Bookings'],
        summary: 'Get one of the authenticated user\'s bookings',
        description: 'A booking owned by another user returns 404 (existence is not leaked).',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: 'Booking with nested test and centre.',
            ...jsonContent({
              type: 'object',
              properties: { booking: { $ref: '#/components/schemas/Booking' } },
            }),
          },
          400: errorResponse('Invalid UUID.'),
          401: errorResponse('Missing or invalid token.'),
          404: errorResponse('Booking not found (or not owned).'),
        },
      },
    },

    '/api/bookings/{id}/cancel': {
      patch: {
        tags: ['Bookings'],
        summary: 'Cancel a booking',
        description: 'Only PENDING or CONFIRMED bookings can be cancelled.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: 'Booking cancelled (status CANCELLED).',
            ...jsonContent({
              type: 'object',
              properties: {
                message: { type: 'string' },
                booking: { $ref: '#/components/schemas/Booking' },
              },
            }),
          },
          400: errorResponse('Booking cannot be cancelled in its current state.'),
          401: errorResponse('Missing or invalid token.'),
          404: errorResponse('Booking not found (or not owned).'),
        },
      },
    },

    '/api/payments': {
      post: {
        tags: ['Payments'],
        summary: 'Process a mock payment for a booking',
        description:
          'Only the booking owner may pay, and only a PENDING booking. On SUCCESS the ' +
          'booking becomes CONFIRMED; on FAILED it becomes FAILED. Amount comes from the ' +
          'booking; transactionId is server-generated.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          ...jsonContent({ $ref: '#/components/schemas/PaymentRequest' }),
        },
        responses: {
          200: {
            description: 'Payment processed (SUCCESS or FAILED).',
            ...jsonContent({
              type: 'object',
              properties: {
                message: { type: 'string' },
                payment: { $ref: '#/components/schemas/Payment' },
                booking: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    status: { $ref: '#/components/schemas/BookingStatus' },
                  },
                },
              },
            }),
          },
          400: errorResponse('Validation error, or booking not in a payable (PENDING) state.'),
          401: errorResponse('Missing or invalid token.'),
          404: errorResponse('Booking not found (or not owned).'),
        },
      },
    },

    '/api/payments/webhook': {
      post: {
        tags: ['Webhook'],
        summary: 'Payment-provider webhook (idempotent)',
        description:
          'NOT authenticated with a user JWT — it represents a provider callback. ' +
          'Idempotent by eventId: duplicate/concurrent deliveries do not create ' +
          'duplicate payments or events. Amount is derived from the booking.',
        security: [],
        requestBody: {
          required: true,
          ...jsonContent({ $ref: '#/components/schemas/WebhookRequest' }),
        },
        responses: {
          200: {
            description:
              'Processed successfully, or an idempotent acknowledgement of an ' +
              'already-processed event.',
            ...jsonContent({
              type: 'object',
              properties: {
                message: { type: 'string' },
                eventId: { type: 'string' },
                payment: { $ref: '#/components/schemas/Payment' },
                booking: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    status: { $ref: '#/components/schemas/BookingStatus' },
                  },
                },
              },
            }),
          },
          400: errorResponse('Validation error, or booking not in a processable (PENDING) state.'),
          404: errorResponse('Booking not found.'),
          409: errorResponse('A payment already exists for this booking.'),
        },
      },
    },
  },
};

module.exports = openapiSpec;
