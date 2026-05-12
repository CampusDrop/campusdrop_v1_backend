const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MATCHING_PERIOD_ANCHOR_ISO,
  getMatchingPeriodStart,
  getMatchingPeriodEnd,
  findUserMatchingForMeetChat,
} = require('../lib/matchPolicy');

test('matching period starts on Tuesday 00:00 KST', () => {
  assert.equal(MATCHING_PERIOD_ANCHOR_ISO, '2026-04-14T00:00:00.000+09:00');

  const mondayNight = new Date('2026-04-20T23:59:59.000+09:00');
  const tuesdayStart = new Date('2026-04-21T00:00:00.000+09:00');

  assert.equal(getMatchingPeriodStart(mondayNight).toISOString(), '2026-04-13T15:00:00.000Z');
  assert.equal(getMatchingPeriodStart(tuesdayStart).toISOString(), '2026-04-20T15:00:00.000Z');
  assert.equal(
    getMatchingPeriodEnd(getMatchingPeriodStart(tuesdayStart)).toISOString(),
    '2026-04-27T15:00:00.000Z',
  );
});

test('findUserMatchingForMeetChat resolves prev-period DB row when meeting time matches chat window', async () => {
  const now = new Date('2026-05-12T17:02:00.000+09:00');
  const periodStart = getMatchingPeriodStart(now);
  const prevPeriodStart = new Date(periodStart.getTime() - 7 * 86400000);

  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const meetingAt = new Date('2026-05-12T17:00:00.000+09:00');

  const carryRow = {
    id: 'm1',
    userAId: userId,
    userBId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    score: 80,
    matchedAt: new Date('2026-05-11T10:00:00.000+09:00'),
    meetingStartsAt: meetingAt,
    meetingVenueName: '카페',
    cafeId: null,
    periodStart: prevPeriodStart,
    matchReport: null,
    userA: { id: userId, nickname: 'me' },
    userB: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', nickname: 'them' },
    cafe: null,
  };

  const mockPrisma = {
    matching: {
      findMany: async () => [carryRow],
    },
  };

  const hit = await findUserMatchingForMeetChat(mockPrisma, userId, 'ROMANCE', now);
  assert.equal(hit?.id, 'm1');
});

test('findUserMatchingForMeetChat picks soonest upcoming when chat window not open yet', async () => {
  const now = new Date('2026-05-12T10:00:00.000+09:00');
  const primary = {
    id: 'p0',
    userAId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userBId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    score: 90,
    matchedAt: new Date('2026-05-12T01:00:00.000+09:00'),
    meetingStartsAt: new Date('2026-05-13T12:00:00.000+09:00'),
    meetingVenueName: null,
    cafeId: null,
    periodStart: getMatchingPeriodStart(now),
    matchReport: null,
    userA: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nickname: 'a' },
    userB: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', nickname: 'b' },
    cafe: null,
  };

  const mockPrisma = {
    matching: {
      findMany: async () => [primary],
    },
  };

  const hit = await findUserMatchingForMeetChat(
    mockPrisma,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'ROMANCE',
    now,
  );
  assert.equal(hit?.id, 'p0');
});

test('findUserMatchingForMeetChat prefers row whose chat window is active', async () => {
  const now = new Date('2026-05-12T17:02:00.000+09:00');
  const earlierMeetingNextDay = {
    id: 'tomorrow',
    userAId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userBId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    score: 80,
    matchedAt: new Date('2026-05-12T09:00:00.000+09:00'),
    meetingStartsAt: new Date('2026-05-13T12:00:00.000+09:00'),
    meetingVenueName: null,
    cafeId: null,
    periodStart: null,
    matchReport: null,
    userA: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nickname: 'a' },
    userB: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', nickname: 'b' },
    cafe: null,
  };
  const todayInWindow = {
    id: 'today',
    userAId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userBId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    score: 70,
    matchedAt: new Date('2026-05-11T10:00:00.000+09:00'),
    meetingStartsAt: new Date('2026-05-12T17:00:00.000+09:00'),
    meetingVenueName: null,
    cafeId: null,
    periodStart: null,
    matchReport: null,
    userA: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nickname: 'a' },
    userB: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', nickname: 'c' },
    cafe: null,
  };

  const mockPrisma = {
    matching: {
      findMany: async () => [earlierMeetingNextDay, todayInWindow],
    },
  };

  const hit = await findUserMatchingForMeetChat(
    mockPrisma,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'ROMANCE',
    now,
  );
  assert.equal(hit?.id, 'today');
});