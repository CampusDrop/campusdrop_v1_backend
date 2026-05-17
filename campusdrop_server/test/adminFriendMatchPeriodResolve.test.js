const test = require('node:test');
const assert = require('node:assert/strict');
const { getSurveyTargetPeriodStartForApplicationPeriod } = require('../lib/surveyAvailabilityWindow');
const {
  resolveApplicationPeriodStart,
  applicationPeriodStartFromMeetingTargetWeekStart,
} = require('../lib/matchPolicy');

test('resolveApplicationPeriodStart snaps UTC calendar noise to matching week anchor', () => {
  const rawUi = new Date('2026-05-12T00:00:00.000Z');
  const ps = resolveApplicationPeriodStart(rawUi);
  assert.equal(ps.toISOString(), '2026-05-11T15:00:00.000Z');
  assert.equal(
    getSurveyTargetPeriodStartForApplicationPeriod(ps).toISOString(),
    '2026-05-18T15:00:00.000Z',
  );
});

test('applicationPeriodStartFromMeetingTargetWeekStart maps meeting-target week → application week', () => {
  const app = resolveApplicationPeriodStart(new Date('2026-05-12T00:00:00.000Z'));
  const target = getSurveyTargetPeriodStartForApplicationPeriod(app);
  assert.equal(applicationPeriodStartFromMeetingTargetWeekStart(target).toISOString(), app.toISOString());
});
