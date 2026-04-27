const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSurveyAvailabilityWindow,
  validateSurveyAvailabilityForCurrentWindow,
} = require('../lib/surveyAvailabilityWindow');

test('application window opens Tuesday 00:00 KST and targets next Tuesday-Sunday', () => {
  const window = buildSurveyAvailabilityWindow(new Date('2026-04-21T00:00:00.000+09:00'));

  assert.equal(window.isOpen, true);
  assert.equal(window.application.opensAt, '2026-04-20T15:00:00.000Z');
  assert.equal(window.application.closesAt, '2026-04-26T09:00:00.000Z');
  assert.deepEqual(
    window.target.dates.map((d) => d.date),
    ['2026-04-28', '2026-04-29', '2026-04-30', '2026-05-01', '2026-05-02', '2026-05-03'],
  );
  assert.deepEqual(
    window.target.dates.map((d) => d.dayOfWeekKo),
    ['화', '수', '목', '금', '토', '일'],
  );
});

test('application window closes Sunday 18:00 KST', () => {
  assert.equal(buildSurveyAvailabilityWindow(new Date('2026-04-26T17:59:59.000+09:00')).isOpen, true);
  assert.equal(buildSurveyAvailabilityWindow(new Date('2026-04-26T18:00:00.000+09:00')).isOpen, false);
  assert.equal(buildSurveyAvailabilityWindow(new Date('2026-04-27T12:00:00.000+09:00')).isOpen, false);
});

test('availability validation only accepts target dates while open', () => {
  const now = new Date('2026-04-21T12:00:00.000+09:00');
  const ok = validateSurveyAvailabilityForCurrentWindow(
    [{ date: '2026-04-28', time_slot: '11:00-12:00' }],
    now,
  );
  const badDate = validateSurveyAvailabilityForCurrentWindow(
    [{ date: '2026-04-27', time_slot: '11:00-12:00' }],
    now,
  );
  const closed = validateSurveyAvailabilityForCurrentWindow(
    [{ date: '2026-04-28', time_slot: '11:00-12:00' }],
    new Date('2026-04-27T12:00:00.000+09:00'),
  );

  assert.equal(ok.ok, true);
  assert.equal(badDate.ok, false);
  assert.equal(badDate.status, 400);
  assert.equal(closed.ok, false);
  assert.equal(closed.status, 403);
});
