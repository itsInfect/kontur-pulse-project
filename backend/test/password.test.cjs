const assert = require('node:assert/strict');
const test = require('node:test');
const { hash: hashArgon2 } = require('argon2');
const { hashPassword, verifyPassword } = require('../dist/password.js');

test('new password hashes are salted and verify only the correct password', async () => {
  const first = await hashPassword('Password123');
  const second = await hashPassword('Password123');
  assert.match(first, /^scrypt:v1:/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(first, 'Password123'), true);
  assert.equal(await verifyPassword(first, 'Wrong123'), false);
  assert.equal(await verifyPassword('scrypt:v1:invalid:invalid', 'Password123'), false);
});

test('existing argon2 password hashes remain valid', async () => {
  const legacy = await hashArgon2('Password123');
  assert.equal(await verifyPassword(legacy, 'Password123'), true);
  assert.equal(await verifyPassword(legacy, 'Wrong123'), false);
});
