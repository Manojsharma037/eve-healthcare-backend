const prisma = require('../src/prisma');

// Minimal database connectivity smoke test.
//
// Proves the test infrastructure can reach the TEST database (eve_healthcare_test)
// and that the schema/migrations are present, by writing and reading one row.
//
// It uses the WebhookEvent model (the simplest table: just a unique eventId) and
// performs targeted cleanup of exactly the row it created — no truncation, no
// reset, nothing destructive.
describe('Database connectivity (test DB)', () => {
  // A unique, clearly-labelled key so the row can never collide with real data
  // and is trivial to identify/remove.
  const eventId = `smoke-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  afterAll(async () => {
    // Targeted cleanup: remove only the record this test created, then disconnect
    // so Jest can exit cleanly.
    await prisma.webhookEvent.deleteMany({ where: { eventId } });
    await prisma.$disconnect();
  });

  test('can create, read, and delete a WebhookEvent row', async () => {
    const created = await prisma.webhookEvent.create({ data: { eventId } });
    expect(created.id).toBeDefined();
    expect(created.eventId).toBe(eventId);

    const found = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect(found).not.toBeNull();
    expect(found.eventId).toBe(eventId);

    const deleted = await prisma.webhookEvent.delete({ where: { eventId } });
    expect(deleted.eventId).toBe(eventId);

    const afterDelete = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect(afterDelete).toBeNull();
  });
});
