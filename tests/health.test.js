const request = require('supertest');
const app = require('../src/app');

// Smoke test: proves the Jest + Supertest infrastructure works end to end.
// It imports the Express app directly (no running server, no database needed)
// and exercises the /health endpoint.
describe('Health check', () => {
  test('GET /health returns 200 with the expected body', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('EVE Healthcare Backend');
  });
});
