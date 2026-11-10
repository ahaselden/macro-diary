// Added after the PR #16 review (not written by the test designer): two exotic IPv6 ranges the first guard version let through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, checkUrl } from '../supabase/functions/fetch-recipe/guard.js';

test('X1 IPv4-translated ::ffff:0:a.b.c.d is judged by the embedded IPv4 address', () => {
  for (const ip of ['::ffff:0:7f00:1', '::ffff:0:a00:1', '::ffff:0:a9fe:a9fe']) assert.equal(isPrivateAddress(ip), true, ip);
  assert.equal(isPrivateAddress('::ffff:0:808:808'), false);
  assert.equal(checkUrl('http://[::ffff:0:7f00:1]/').ok, false);
});

test('X2 64:ff9b:1::/48 (local-use NAT64) is refused; the well-known 64:ff9b::/96 is judged by the embedded IPv4 address', () => {
  for (const ip of ['64:ff9b:1::1', '64:ff9b:1:ffff::1']) assert.equal(isPrivateAddress(ip), true, ip);
  assert.equal(isPrivateAddress('64:ff9b::7f00:1'), true);
  assert.equal(isPrivateAddress('64:ff9b::808:808'), false);
});
