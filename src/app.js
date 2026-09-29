const express = require('express');
const swaggerUi = require('swagger-ui-express');

const authRoutes = require('./routes/auth.routes');
const centreRoutes = require('./routes/centre.routes');
const testRoutes = require('./routes/test.routes');
const bookingRoutes = require('./routes/booking.routes');
const paymentRoutes = require('./routes/payment.routes');
const openapiSpec = require('./docs/openapi');
const { notFound, errorHandler } = require('./middleware/error.middleware');

const app = express();

// Parse incoming JSON request bodies
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'EVE Healthcare Backend',
  });
});

// Feature routes
app.use('/api/auth', authRoutes);
app.use('/api/centres', centreRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);

// API documentation: raw OpenAPI spec + interactive Swagger UI.
// Mounted on its own path so it never interferes with the API routes above.
app.get('/api/docs.json', (req, res) => res.json(openapiSpec));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

// 404 + centralized error handling (must be registered last)
app.use(notFound);
app.use(errorHandler);

module.exports = app;
