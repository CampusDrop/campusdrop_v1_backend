const test = require('node:test');
const assert = require('node:assert/strict');
const { assignCafesToPairs, slotKeyFromInsertRow } = require('../lib/cafeAssignment');

function row({ score, date, timeSlot }) {
  return {
    userAId: `${score}-a`,
    userBId: `${score}-b`,
    score,
    matchReport:
      date && timeSlot ? { matchedSlot: { date, time_slot: timeSlot } } : undefined,
  };
}

test('slotKeyFromInsertRow returns null when matchedSlot is missing', () => {
  assert.equal(slotKeyFromInsertRow(null), null);
  assert.equal(slotKeyFromInsertRow({}), null);
  assert.equal(slotKeyFromInsertRow({ matchReport: {} }), null);
});

test('slotKeyFromInsertRow encodes (date, hourStart) as YYYY-MM-DD|H', () => {
  const r = row({ score: 80, date: '2026-05-15', timeSlot: '14:00-15:00' });
  assert.equal(slotKeyFromInsertRow(r), '2026-05-15|14');
});

test('slotKeyFromInsertRow accepts compact "14-15" form too', () => {
  const r = {
    matchReport: { matchedSlot: { date: '2026-05-15', time_slot: '14-15' } },
  };
  assert.equal(slotKeyFromInsertRow(r), '2026-05-15|14');
});

test('assignCafesToPairs is a no-op when no cafes are provided', () => {
  const r = row({ score: 90, date: '2026-05-15', timeSlot: '14:00-15:00' });
  assignCafesToPairs([r], []);
  assert.equal(r.cafeId, undefined);
  assert.equal(r.meetingVenueName, undefined);
});

test('assignCafesToPairs leaves rows without matchedSlot untouched', () => {
  const r = row({ score: 90 });
  const cafes = [{ id: 'cafe-A', name: '제주몰빵' }];
  assignCafesToPairs([r], cafes);
  assert.equal(r.cafeId, undefined);
  assert.equal(r.meetingVenueName, undefined);
});

test('assignCafesToPairs round-robins cafes inside each slot by score desc', () => {
  const a = row({ score: 95, date: '2026-05-15', timeSlot: '14:00-15:00' });
  const b = row({ score: 80, date: '2026-05-15', timeSlot: '14:00-15:00' });
  const c = row({ score: 70, date: '2026-05-15', timeSlot: '14:00-15:00' });
  const cafes = [
    { id: 'cafe-1', name: '제주몰빵' },
    { id: 'cafe-2', name: '트레비커피로스터스' },
  ];

  assignCafesToPairs([b, a, c], cafes);

  assert.equal(a.cafeId, 'cafe-1');
  assert.equal(a.meetingVenueName, '제주몰빵');
  assert.equal(b.cafeId, 'cafe-2');
  assert.equal(b.meetingVenueName, '트레비커피로스터스');
  // Wraps around — only 2 cafes, so the 3rd pair (lowest score) takes cafe-1 again.
  assert.equal(c.cafeId, 'cafe-1');
  assert.equal(c.meetingVenueName, '제주몰빵');
});

test('assignCafesToPairs distributes per slot independently', () => {
  const aPm = row({ score: 90, date: '2026-05-15', timeSlot: '14:00-15:00' });
  const bPm = row({ score: 85, date: '2026-05-15', timeSlot: '14:00-15:00' });
  const aAm = row({ score: 88, date: '2026-05-15', timeSlot: '11:00-12:00' });
  const cafes = [
    { id: 'cafe-1', name: 'C1' },
    { id: 'cafe-2', name: 'C2' },
  ];

  assignCafesToPairs([aPm, bPm, aAm], cafes);

  // 14:00 슬롯의 두 쌍은 score desc로 cafe-1, cafe-2.
  assert.equal(aPm.cafeId, 'cafe-1');
  assert.equal(bPm.cafeId, 'cafe-2');
  // 11:00 슬롯은 따로 라운드로빈을 시작 — 첫 번째 카페부터.
  assert.equal(aAm.cafeId, 'cafe-1');
});

test('assignCafesToPairs single cafe also places one pair per slot', () => {
  const a = row({ score: 90, date: '2026-05-15', timeSlot: '14:00-15:00' });
  const b = row({ score: 80, date: '2026-05-15', timeSlot: '14:00-15:00' });
  const cafes = [{ id: 'only-cafe', name: '단일' }];

  assignCafesToPairs([a, b], cafes);

  // 라운드로빈 wraparound 자체는 막지 않으므로 두 쌍 모두 같은 카페가 배정된다.
  // (Python 측에서 max_matches_per_slot=1로 호출하면 애초에 같은 슬롯에 2쌍이 오지 않는다.)
  assert.equal(a.cafeId, 'only-cafe');
  assert.equal(b.cafeId, 'only-cafe');
});
