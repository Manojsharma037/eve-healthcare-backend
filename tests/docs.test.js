const request = require('supertest');
const app = require('../src/app');

// Smoke tests for the API documentation. These assert the docs are mounted and
// the spec is well-formed — not every documentation line (kept non-brittle).
describe('API documentation', () => {
  test('GET /api/docs serves the Swagger UI page', async () => {
    const res = await request(app).get('/api/docs/').set('Accept', 'text/html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });

  test('GET /api/docs.json returns a valid OpenAPI 3 spec', async () => {
    const res = await request(app).get('/api/docs.json');
    expect(res.status).toBe(200);

    // openapi version + info
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info).toBeDefined();
    expect(typeof res.body.info.title).toBe('string');

    // paths include the real endpoints
    expect(res.body.paths).toBeDefined();
    expect(res.body.paths['/api/auth/login']).toBeDefined();
    expect(res.body.paths['/api/payments/webhook']).toBeDefined();

    // bearerAuth security scheme is defined
    expect(res.body.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: expect.any(String),
    });

    // A protected route requires bearerAuth; the webhook must NOT.
    expect(res.body.paths['/api/bookings'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(res.body.paths['/api/payments/webhook'].post.security).toEqual([]);
  });
});
