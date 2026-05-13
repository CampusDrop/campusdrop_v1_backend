const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isWithinKakaoFriendTalkSendWindow,
  msUntilKakaoFriendTalkSendWindowOpens,
} = require('../lib/kakaoFriendTalkSendWindow');

test('08:00 KST is outside window (opens at 08:01)', () => {
  const d = new Date('2026-05-14T23:00:00.000Z'); // 2026-05-15 08:00 KST
  assert.equal(isWithinKakaoFriendTalkSendWindow(d), false);
  const ms = msUntilKakaoFriendTalkSendWindowOpens(d);
  assert.ok(ms > 0 && ms <= 70 * 1000, `expected ~1 min, got ${ms}`);
});

test('08:01 KST is inside window', () => {
  const d = new Date('2026-05-14T23:01:00.000Z');
  assert.equal(isWithinKakaoFriendTalkSendWindow(d), true);
  assert.equal(msUntilKakaoFriendTalkSendWindowOpens(d), 0);
});

test('20:49 KST is inside window', () => {
  const d = new Date('2026-05-16T11:49:00.000Z'); // 2026-05-16 20:49 KST
  assert.equal(isWithinKakaoFriendTalkSendWindow(d), true);
});

test('20:50 KST is outside window; ms until next open is until tomorrow 08:01', () => {
  const d = new Date('2026-05-16T11:50:00.000Z');
  assert.equal(isWithinKakaoFriendTalkSendWindow(d), false);
  const ms = msUntilKakaoFriendTalkSendWindowOpens(d);
  const hours = ms / 3600000;
  assert.ok(hours > 10 && hours < 12, `expected ~11h, got ${hours}h`);
});
