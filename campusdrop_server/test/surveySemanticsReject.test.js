const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSurveyPayload } = require('../lib/surveyValidation');

const MINIMAL = {
  energy: 3,
  weekend: 3,
  pattern: 3,
  trend: 3,
  alcohol: '가끔',
  smoking: '비흡연',
  tattoo: '없음',
  contact: 3,
  meeting: 3,
  planning: 3,
  affection: 3,
  date_expense: 3,
  friends: 3,
  jealousy: 3,
  skinship_speed: 3,
  skinship_limit: '단계적으로',
  date_drinking: 2,
  politics: 3,
  religion_type: '없음',
  marriage_view: 3,
  meeting_seriousness: 3,
  job_view: 3,
  spending: 3,
  conflict: 3,
  empathy: 3,
  honesty: 3,
  trust: 3,
  gender: '남성',
  pref_cc: '상관없음',
  pref_smoking: '상관없음',
  pref_tattoo: '상관없음',
  pref_religion: '상관없음',
  self_care_habit: '상황에 따라 다름, 컨디션이 좋을 때는 집중 관리하고 바쁠 때는 쉬어감',
  religion_acceptance: '종교 상관없으나 권유는 사절',
  availability: [{ date: '2026-04-20', time_slot: '11:00-12:00' }],
};

test('unknown smoking label → 400', () => {
  const r = validateSurveyPayload({ ...MINIMAL, smoking: '알 수 없는 흡연값' });
  assert.equal(r.ok, false);
  assert.ok(String(r.error).includes('smoking'));
});

test('unknown pref_smoking label → 400', () => {
  const r = validateSurveyPayload({ ...MINIMAL, pref_smoking: '전혀모름' });
  assert.equal(r.ok, false);
  assert.ok(String(r.error).includes('pref_smoking'));
});

test('unknown self_care_habit label → 400', () => {
  const r = validateSurveyPayload({ ...MINIMAL, self_care_habit: '알 수 없는 값' });
  assert.equal(r.ok, false);
  assert.ok(String(r.error).includes('self_care_habit'));
});
