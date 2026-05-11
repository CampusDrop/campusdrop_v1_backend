const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MATCH_DAY_EVE_REMINDER_TEXT,
  buildMatchCompleteText,
  buildMatchDayEveReminderText,
} = require('../lib/friendTalkTemplates');

test('buildMatchCompleteText removes the year from meeting time', () => {
  const out = buildMatchCompleteText('2026년 5월 13일 (수) 오후 1시', '제주몰빵');

  assert.ok(out.includes('📍 일시: 5월 13일 (수) 오후 1시'));
  assert.ok(!out.includes('📍 일시: 2026년'));
  assert.ok(out.includes('📍 장소: 제주몰빵'));
});

test('buildMatchDayEveReminderText interpolates time/place without year when both provided', () => {
  const out = buildMatchDayEveReminderText({
    meetingTime: '2026년 5월 16일 (토) 오후 2시',
    meetingPlace: '제주몰빵',
  });
  assert.ok(out.includes('📍 일시: 5월 16일 (토) 오후 2시'));
  assert.ok(!out.includes('📍 일시: 2026년'));
  assert.ok(out.includes('📍 장소: 제주몰빵'));
  assert.ok(!out.includes('#{미팅일시}'));
  assert.ok(!out.includes('#{미팅장소}'));
});

test('buildMatchDayEveReminderText drops the time/place block when missing', () => {
  const out = buildMatchDayEveReminderText({});
  assert.ok(!out.includes('#{미팅일시}'));
  assert.ok(!out.includes('#{미팅장소}'));
  assert.ok(!out.includes('📍 일시'));
  assert.ok(!out.includes('📍 장소'));
  assert.ok(out.startsWith('[Campus Drop]'));
});

test('MATCH_DAY_EVE_REMINDER_TEXT raw template still has placeholders', () => {
  assert.ok(MATCH_DAY_EVE_REMINDER_TEXT.includes('#{미팅일시}'));
  assert.ok(MATCH_DAY_EVE_REMINDER_TEXT.includes('#{미팅장소}'));
});
