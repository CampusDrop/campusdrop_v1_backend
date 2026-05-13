const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSurveyPayload, identityProfileColumnsFromSurveyData } = require('../lib/surveyValidation');

function minimalSurvey(phase1Overrides = {}, phase3Overrides = {}, phase6Overrides = {}) {
  return {
    surveyAnswers: {
      phase1_lifestyle: {
        meeting_tension: 3,
        weekend_activity: 3,
        lifestyle_pattern: 3,
        fashion_interest: 3,
        hobby_type: 3,
        drinking_preference: 3,
        smoking_status: 'NON_SMOKER',
        tattoo_status: 'NO_TATTOO',
        ...phase1Overrides,
      },
      phase2_relationship_views: {
        contact_frequency: 3,
        meeting_frequency: 3,
        date_planning: 3,
        verbal_affection: 3,
        dating_cost: 3,
      },
      phase3_opposite_sex_and_intimacy: {
        opposite_sex_friends: 3,
        jealousy_level: 3,
        intimacy_speed: 3,
        intimacy_openness: 3,
        drinking_on_date: 'ANY',
        ...phase3Overrides,
      },
      phase4_beliefs_and_values: {
        political_view: 3,
        faith_depth: 3,
        marriage_view: 3,
        relationship_seriousness: 3,
        work_value: 3,
        spending_habit: 3,
        religion: 'NONE',
      },
      phase5_emotion_and_conflict: {
        conflict_resolution: 3,
        empathy_level: 3,
        expressing_discomfort: 3,
        reliance_level: 3,
        self_management: 3,
      },
      phase6_partner_preferences: {
        campus_couple_openness: 3,
        partner_age_preference: ['OLDER', 'SAME_AGE', 'YOUNGER'],
        partner_smoking_tolerance: 3,
        partner_tattoo_tolerance: 3,
        partner_religion_tolerance: 3,
        ...phase6Overrides,
      },
    },
    gender: '남성',
    availability: [{ date: '2026-04-20', time_slot: '11:00-12:00' }],
    participantMeta: { profile: { phone: '01012345678' } },
  };
}

test('invalid smoking_status enum → 400', () => {
  const r = validateSurveyPayload(minimalSurvey({ smoking_status: 'LIGHT_SMOKER' }));
  assert.equal(r.ok, false);
  assert.ok(String(r.error).includes('smoking_status'));
});

test('invalid drinking_on_date enum → 400', () => {
  const r = validateSurveyPayload(minimalSurvey({}, { drinking_on_date: 'SOMETIMES' }));
  assert.equal(r.ok, false);
  assert.ok(String(r.error).includes('drinking_on_date'));
});

test('invalid partner_age_preference multi-select enum → 400', () => {
  const r = validateSurveyPayload(minimalSurvey({}, {}, { partner_age_preference: ['OLDER', 'ANY_AGE'] }));
  assert.equal(r.ok, false);
  assert.ok(String(r.error).includes('partner_age_preference'));
});

test('partner_age_preference allows duplicates and preserves order', () => {
  const r = validateSurveyPayload(
    minimalSurvey({}, {}, { partner_age_preference: ['OLDER', 'OLDER', 'YOUNGER', 'SAME_AGE'] }),
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.surveyAnswers.phase6_partner_preferences.partner_age_preference, [
    'OLDER',
    'OLDER',
    'YOUNGER',
    'SAME_AGE',
  ]);
});

test('invalid participantMeta.profile.department → 400', () => {
  const p = minimalSurvey();
  p.participantMeta = { profile: { department: '없는학과', gender: '남성', phone: '01012345678' } };
  const r = validateSurveyPayload(p);
  assert.equal(r.ok, false);
  assert.ok(String(r.error).includes('department'));
});

test('invalid religion enum → 400', () => {
  const r = validateSurveyPayload(
    (() => {
      const p = minimalSurvey();
      p.surveyAnswers.phase4_beliefs_and_values = {
        ...p.surveyAnswers.phase4_beliefs_and_values,
        religion: 'MUSLIM',
      };
      return p;
    })(),
  );
  assert.equal(r.ok, false);
  assert.ok(String(r.error).includes('religion'));
});

test('minimal valid payload → ok + nested surveyAnswers', () => {
  const r = validateSurveyPayload(minimalSurvey());
  assert.equal(r.ok, true);
  assert.ok(r.data && r.data.surveyAnswers && r.data.surveyAnswers.phase1_lifestyle);
  assert.equal(r.data.surveyAnswers.phase1_lifestyle.smoking_status, 'NON_SMOKER');
  assert.equal(r.data.surveyAnswers.phase3_opposite_sex_and_intimacy.drinking_on_date, 'ANY');
  assert.deepEqual(r.data.surveyAnswers.phase6_partner_preferences.partner_age_preference, [
    'OLDER',
    'SAME_AGE',
    'YOUNGER',
  ]);
  assert.equal(r.data.matchProfile.smoking.label, 'NON_SMOKER');
});

test('participantMeta.profile.phone 누락 → 400', () => {
  const p = minimalSurvey();
  delete p.participantMeta;
  const r = validateSurveyPayload(p);
  assert.equal(r.ok, false);
  assert.ok(String(r.error).includes('phone'));
});

test('participantMeta.profile.phone 만 있으면 루트 profile로도 통과', () => {
  const p = minimalSurvey();
  delete p.participantMeta;
  p.profile = { phone: '01012345678' };
  const r = validateSurveyPayload(p);
  assert.equal(r.ok, true);
});

test('participantMeta.profile.phone 형식 오류 → 400', () => {
  const p = minimalSurvey();
  p.participantMeta = { profile: { phone: '0212345678' } };
  const r = validateSurveyPayload(p);
  assert.equal(r.ok, false);
  assert.ok(String(r.error).includes('010'));
});

test('participantMeta.profile.department → stored profile + identity columns', () => {
  const p = minimalSurvey();
  p.participantMeta = { profile: { department: '컴퓨터공학과', gender: '남성', phone: '01012345678' } };
  const r = validateSurveyPayload(p);
  assert.equal(r.ok, true);
  assert.equal(r.data.participantMeta.profile.department, '컴퓨터공학과');
  assert.deepEqual(identityProfileColumnsFromSurveyData(r.data), {
    department: '컴퓨터공학과',
    phone: '01012345678',
  });
});

test('religion NONE → faith_depth 생략 가능', () => {
  const p = minimalSurvey();
  const p4 = { ...p.surveyAnswers.phase4_beliefs_and_values };
  delete p4.faith_depth;
  p.surveyAnswers.phase4_beliefs_and_values = p4;
  const r = validateSurveyPayload(p);
  assert.equal(r.ok, true);
  assert.ok(r.data && r.data.surveyAnswers);
  assert.equal('faith_depth' in r.data.surveyAnswers.phase4_beliefs_and_values, false);
});

test('religion NONE이 아닐 때 faith_depth 필수', () => {
  const p = minimalSurvey();
  const p4 = { ...p.surveyAnswers.phase4_beliefs_and_values, religion: 'BUDDHIST' };
  delete p4.faith_depth;
  p.surveyAnswers.phase4_beliefs_and_values = p4;
  const r = validateSurveyPayload(p);
  assert.equal(r.ok, false);
  assert.ok(String(r.error).includes('faith_depth'));
});
