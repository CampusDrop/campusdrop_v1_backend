const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSurveyPayload } = require('../lib/surveyValidation');

const MINIMAL = {
  energy: 3,
  sleep_habit: 3,
  morning_night: 3,
  cleanliness: 3,
  spending_style: 3,
  meal_style: 3,
  smoking: '비흡연',
  drinking_freq: '가끔',
  exercise: 3,
  caffeine: 3,
  screen_time: 3,
  social_battery: 3,
  humor_importance: 3,
  conflict_style: '상대 흐름에 맞추는 편이에요',
  text_call_pref: '상황에 따라 달라요',
  reply_speed: 3,
  religion_type: '없음',
  politics_importance: 3,
  family_plan_view: 3,
  meet_frequency: 3,
  date_cost_split: 3,
  commitment: 3,
  public_affection: 3,
  alone_time_need: 3,
  campus_date: 3,
  study_together: 3,
  age_gap: 3,
  feedback_opt_in: '예',
  gender: '남성',
  availability: [{ date: '2026-04-20', time_slot: '11:00-12:00' }],
};

test('unknown smoking label → 400', () => {
  const r = validateSurveyPayload({ ...MINIMAL, smoking: '알 수 없는 흡연값' });
  assert.equal(r.ok, false);
  assert.ok(String(r.error).includes('smoking'));
});

test('unknown drinking_freq label → 400', () => {
  const r = validateSurveyPayload({ ...MINIMAL, drinking_freq: '알 수 없는 음주빈도' });
  assert.equal(r.ok, false);
  assert.ok(String(r.error).includes('drinking_freq'));
});

test('unknown conflict_style label → 400', () => {
  const r = validateSurveyPayload({ ...MINIMAL, conflict_style: '알 수 없는 값' });
  assert.equal(r.ok, false);
  assert.ok(String(r.error).includes('conflict_style'));
});
