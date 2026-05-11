const test = require('node:test');
const assert = require('node:assert/strict');
const { buildShortRsvpUrl } = require('../lib/friendTalkRsvp');

test('short RSVP URL stays comfortably under Kakao button URL limit', () => {
  const url = buildShortRsvpUrl('https://campus-drop.com/', 'AbCdEf123456');

  assert.equal(url, 'https://campus-drop.com/api/friend-talk/r/AbCdEf123456');
  assert.ok(url.length < 300);
});
