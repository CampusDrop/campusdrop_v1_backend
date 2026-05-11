const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RSVP_YES,
  RSVP_NO,
  MONDAY_OUTCOME_CONFIRMED,
  MONDAY_OUTCOME_CANCELLED,
  buildShortRsvpUrl,
  mondayOutcomeFromRsvps,
} = require('../lib/friendTalkRsvp');

test('short RSVP URL stays comfortably under Kakao button URL limit', () => {
  const url = buildShortRsvpUrl('https://campus-drop.com/', 'AbCdEf123456');

  assert.equal(url, 'https://campus-drop.com/api/friend-talk/r/AbCdEf123456');
  assert.ok(url.length < 300);
});

test('mondayOutcomeFromRsvps confirms only when both users accept', () => {
  assert.equal(mondayOutcomeFromRsvps(RSVP_YES, RSVP_YES), MONDAY_OUTCOME_CONFIRMED);
  assert.equal(mondayOutcomeFromRsvps(RSVP_YES, RSVP_NO), MONDAY_OUTCOME_CANCELLED);
  assert.equal(mondayOutcomeFromRsvps(RSVP_NO, RSVP_YES), MONDAY_OUTCOME_CANCELLED);
  assert.equal(mondayOutcomeFromRsvps(RSVP_NO, RSVP_NO), MONDAY_OUTCOME_CANCELLED);
});

test('mondayOutcomeFromRsvps waits until both RSVP values exist', () => {
  assert.equal(mondayOutcomeFromRsvps(RSVP_YES, null), null);
  assert.equal(mondayOutcomeFromRsvps(null, RSVP_NO), null);
});
