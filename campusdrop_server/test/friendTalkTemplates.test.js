const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MATCH_DAY_EVE_REMINDER_TEXT,
  buildMatchDayEveReminderText,
} = require('../lib/friendTalkTemplates');

test('buildMatchDayEveReminderText interpolates time/place when both provided', () => {
  const out = buildMatchDayEveReminderText({
    meetingTime: '2026년 5월 16일 (토) 오후 2시',
    meetingPlace: '제주몰빵',
  });
  assert.ok(out.includes('📍 일시: 2026년 5월 16일 (토) 오후 2시'));
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
