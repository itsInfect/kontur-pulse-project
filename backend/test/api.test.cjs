const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { io } = require('socket.io-client');

if (!process.env.INTEGRATION_DATABASE_URL) {
  if (process.env.CI) throw new Error('INTEGRATION_DATABASE_URL is required in CI');
  test('PostgreSQL integration tests need INTEGRATION_DATABASE_URL', { skip: true }, () => {});
} else {
  test('auth, guest identity, polls, votes and removal', async t => {
    process.env.DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret-at-least-32-characters';
    const { NestFactory } = require('@nestjs/core');
    const { ValidationPipe, UnprocessableEntityException } = require('@nestjs/common');
    const cookieParser = require('cookie-parser');
    const { hash } = require('argon2');
    const { AppModule } = require('../dist/module');
    const { Db } = require('../dist/db');
    const app = await NestFactory.create(AppModule, { rawBody: true, logger: false });
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: errors => new UnprocessableEntityException(errors) }));
    await app.listen(0, '127.0.0.1');
    t.after(() => app.close());
    const db = app.get(Db);
    const http = request(app.getHttpServer());
    const owner = await db.user.create({ data: { email: `owner-${randomUUID()}@example.test`, name: 'Owner', passwordHash: await hash('Password123'), emailVerifiedAt: new Date() } });
    const login = await http.post('/auth/login').send({ email: owner.email, password: 'Password123' }).expect(201);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };
    const refreshCookie = login.headers['set-cookie'][0].split(';')[0];
    await t.test('profile name can be updated', async () => {
      const changed = await http.patch('/auth/me').set(auth).send({ name: 'Owner Updated' }).expect(200);
      assert.equal(changed.body.name, 'Owner Updated');
      assert.equal((await http.get('/auth/me').set(auth).expect(200)).body.name, 'Owner Updated');
    });

    await t.test('refresh rotates and rejects replay', async () => {
      const rotated = await http.post('/auth/refresh').set('Cookie', refreshCookie).expect(201);
      assert.ok(rotated.body.accessToken);
      await http.post('/auth/refresh').set('Cookie', refreshCookie).expect(401);
    });

    const created = await http.post('/conferences').set(auth).send({ title: 'Integration meeting', description: '', startsAt: new Date(Date.now() + 3600000).toISOString(), allowGuests: true }).expect(201);
    const conferenceId = created.body.id;
    await t.test('drafts can be prepared before the meeting starts', async () => {
      const draft = await http.post(`/conferences/${conferenceId}/polls`).set(auth).send({ question: 'Prepared?', options: ['Yes', 'No'] }).expect(201);
      const listing = await http.get(`/conferences/${conferenceId}/interactions`).set(auth).expect(200);
      assert.ok(listing.body.polls.some(poll => poll.id === draft.body.id));
      await http.post(`/polls/${draft.body.id}/publish`).set(auth).expect(409);
      await http.delete(`/polls/${draft.body.id}`).set(auth).expect(200);
    });
    const moderator = await db.user.create({ data: { email: `moderator-${randomUUID()}@example.test`, name: 'Moderator', passwordHash: await hash('Password123'), emailVerifiedAt: new Date() } });
    await http.post(`/conferences/${conferenceId}/moderators`).set(auth).send({ email: moderator.email, canEnd: false }).expect(201);
    await http.post(`/conferences/${conferenceId}/start`).set(auth).expect(201);
    const slug = created.body.slug;
    const moderatorLogin = await http.post('/auth/login').send({ email: moderator.email, password: 'Password123' }).expect(201);
    const moderatorAuth = { Authorization: `Bearer ${moderatorLogin.body.accessToken}` };
    const moderatorJoin = await http.post(`/join/${slug}`).set(moderatorAuth).send({ displayName: 'Moderator' }).expect(201);
    assert.equal(moderatorJoin.body.role, 'MODERATOR');
    await http.post(`/conferences/${conferenceId}/end`).set(moderatorAuth).expect(403);
    const guestJoin = await http.post(`/join/${slug}`).send({ displayName: 'Guest' }).expect(201);
    const guestCookie = guestJoin.headers['set-cookie'][0].split(';')[0];
    const guestId = guestJoin.body.participantId;

    await t.test('realtime connection receives a snapshot and ordered event', async () => {
      const port = app.getHttpServer().address().port;
      const socket = io(`http://127.0.0.1:${port}/events`, { transports: ['websocket'], reconnection: false, auth: { conferenceId, accessToken: login.body.accessToken } });
      t.after(() => socket.disconnect());
      const snapshot = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Snapshot timeout')), 5000);
        socket.once('state.snapshot', value => { clearTimeout(timeout); resolve(value); });
        socket.once('connect_error', reject);
      });
      assert.equal(snapshot.conference.id, conferenceId);
      assert.ok(snapshot.participants.some(person => person.id === guestId));
      const eventPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Event timeout')), 5000);
        socket.once('participant.joined', value => { clearTimeout(timeout); resolve(value); });
      });
      await http.post(`/join/${slug}`).set('Cookie', guestCookie).send({ displayName: 'Guest' }).expect(201);
      const event = await eventPromise;
      assert.ok(event.version > snapshot.version);
      socket.disconnect();
    });

    await t.test('same guest cookie restores participant', async () => {
      const again = await http.post(`/join/${slug}`).set('Cookie', guestCookie).send({ displayName: 'Changed name' }).expect(201);
      assert.equal(again.body.participantId, guestId);
    });

    await t.test('poll answer replacement changes counts', async () => {
      const poll = await http.post(`/conferences/${conferenceId}/polls`).set(auth).send({ question: 'Choose?', options: ['A', 'B'], multiple: false }).expect(201);
      await http.post(`/polls/${poll.body.id}/publish`).set(auth).expect(201);
      await http.post(`/polls/${poll.body.id}/responses`).set('Cookie', guestCookie).send({ selected: [0] }).expect(201);
      await http.post(`/polls/${poll.body.id}/responses`).set('Cookie', guestCookie).send({ selected: [1] }).expect(201);
      const ownListing = await http.get(`/conferences/${conferenceId}/interactions`).set('Cookie', guestCookie).expect(200);
      assert.deepEqual(ownListing.body.polls.find(item => item.id === poll.body.id).selected, [1]);
      const organizerListing = await http.get(`/conferences/${conferenceId}/interactions`).set(auth).expect(200);
      assert.deepEqual(organizerListing.body.polls.find(item => item.id === poll.body.id).selected, []);
      const result = await http.get(`/polls/${poll.body.id}/results`).set('Cookie', guestCookie).expect(200);
      assert.deepEqual(result.body.answers, [0, 1]);
      assert.equal(result.body.respondents, 1);
      await http.post(`/polls/${poll.body.id}/close`).set(auth).expect(201);
      await http.post(`/polls/${poll.body.id}/responses`).set('Cookie', guestCookie).send({ selected: [0] }).expect(409);
    });

    await t.test('vote freezes eligibility, hides live totals and accepts one ballot', async () => {
      const vote = await http.post(`/conferences/${conferenceId}/votes`).set(auth).send({ question: 'Approve?', options: ['Yes', 'No'] }).expect(201);
      await http.post(`/votes/${vote.body.id}/open`).set(auth).expect(201);
      const late = await http.post(`/join/${slug}`).send({ displayName: 'Late' }).expect(201);
      const lateCookie = late.headers['set-cookie'][0].split(';')[0];
      await http.post(`/votes/${vote.body.id}/ballots`).set('Cookie', lateCookie).send({ selected: 0 }).expect(403);
      await http.get(`/votes/${vote.body.id}/results`).set('Cookie', guestCookie).expect(403);
      const listing = await http.get(`/conferences/${conferenceId}/interactions`).set('Cookie', guestCookie).expect(200);
      const openVote = listing.body.votes.find(item => item.id === vote.body.id);
      assert.equal(openVote.eligible, true);
      assert.equal(openVote.results, undefined);
      await http.post(`/votes/${vote.body.id}/ballots`).set('Cookie', guestCookie).send({ selected: 0 }).expect(201);
      await http.post(`/votes/${vote.body.id}/ballots`).set('Cookie', guestCookie).send({ selected: 1 }).expect(409);
      const result = await http.post(`/votes/${vote.body.id}/close`).set(auth).expect(201);
      assert.equal(result.body.eligible, 3);
      assert.equal(result.body.ballots, 1);
      assert.equal(result.body.missing, 2);
      assert.deepEqual(result.body.answers, [1, 0]);
    });

    await t.test('parallel ballots cannot create duplicates', async () => {
      const vote = await http.post(`/conferences/${conferenceId}/votes`).set(auth).send({ question: 'Second decision?', options: ['Yes', 'No'] }).expect(201);
      await http.post(`/votes/${vote.body.id}/open`).set(auth).expect(201);
      const responses = await Promise.all([0, 1].map(selected => http.post(`/votes/${vote.body.id}/ballots`).set('Cookie', guestCookie).send({ selected })));
      assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
      assert.equal(await db.voteBallot.count({ where: { voteId: vote.body.id, participantId: guestId } }), 1);
    });

    await t.test('parallel open requests only transition once', async () => {
      const vote = await http.post(`/conferences/${conferenceId}/votes`).set(auth).send({ question: 'Third decision?', options: ['Yes', 'No'] }).expect(201);
      const results = await Promise.all([0, 1].map(() => http.post(`/votes/${vote.body.id}/open`).set(auth)));
      assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
      assert.equal(await db.voteEligible.count({ where: { voteId: vote.body.id } }), 4);
    });

    await t.test('removed guest cannot rejoin or request media token', async () => {
      await http.delete(`/conferences/${conferenceId}/participants/${guestId}`).set(auth).expect(200);
      await http.post(`/join/${slug}`).set('Cookie', guestCookie).send({ displayName: 'Guest' }).expect(403);
      await http.post(`/conferences/${conferenceId}/media-token`).set('Cookie', guestCookie).expect(403);
    });
    await t.test('owner can delegate ending to a moderator', async () => {
      await http.patch(`/conferences/${conferenceId}/moderators/${moderator.id}`).set(auth).send({ canEnd: true }).expect(200);
      await http.post(`/conferences/${conferenceId}/end`).set(moderatorAuth).expect(201);
      await http.post(`/conferences/${conferenceId}/media-token`).set(moderatorAuth).expect(409);
    });
  });
}
