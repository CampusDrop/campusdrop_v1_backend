const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateFestivalMatchPool,
  computeFestivalPairs,
} = require('../lib/festivalAdminMatch');
const { normalizeFestivalVibeKey, sameFestivalVibe } = require('../lib/festivalVibe');

/** @param {number} id @param {'M'|'F'} gender @param {number} peopleCount @param {string} vibe */
function team(id, gender, peopleCount, vibe) {
  return {
    id: BigInt(id),
    receptionId: `F${id}`,
    peopleCount,
    vibe,
    gender,
    phone: `0101234${String(id).padStart(4, '0')}`,
    status: 'APPLIED',
  };
}

test('normalizeFestivalVibeKey: 도란·시끌 계열', () => {
  assert.equal(normalizeFestivalVibeKey('도란도란'), 'doran');
  assert.equal(normalizeFestivalVibeKey('시끌벅적'), 'sikul');
  assert.ok(sameFestivalVibe('도란', '도란도란'));
});

test('validateFestivalMatchPool: 남녀·1명팀·다인팀 균형', () => {
  const ok = validateFestivalMatchPool(
    [team(1, 'M', 1, '도란'), team(2, 'M', 3, '시끌')],
    [team(3, 'F', 1, '도란'), team(4, 'F', 2, '시끌')],
  );
  assert.equal(ok.ok, true);

  const badGender = validateFestivalMatchPool([team(1, 'M', 1, '도란')], []);
  assert.equal(badGender.ok, false);
  assert.equal(badGender.code, 'FESTIVAL_GENDER_TEAM_IMBALANCE');

  const badSolo = validateFestivalMatchPool(
    [team(1, 'M', 1, '도란'), team(2, 'M', 1, '도란')],
    [team(3, 'F', 2, '시끌'), team(4, 'F', 3, '시끌')],
  );
  assert.equal(badSolo.ok, false);
  assert.equal(badSolo.code, 'FESTIVAL_SOLO_COHORT_IMBALANCE');
});

test('computeFestivalPairs: 같은 무드 우선, 균형 풀은 전원 매칭', () => {
  const males = [
    team(1, 'M', 1, '도란도란'),
    team(2, 'M', 1, '시끌벅적'),
    team(3, 'M', 2, '도란도란'),
    team(4, 'M', 2, '시끌벅적'),
  ];
  const females = [
    team(5, 'F', 1, '도란도란'),
    team(6, 'F', 1, '시끌벅적'),
    team(7, 'F', 3, '도란도란'),
    team(8, 'F', 2, '시끌벅적'),
  ];
  const r = computeFestivalPairs(males, females);
  assert.equal(r.ok, true);
  assert.equal(r.pairedCount, 4);
  assert.equal(r.unmatchedMale, 0);
  assert.equal(r.unmatchedFemale, 0);

  for (const { male: m, female: f } of r.pairs) {
    assert.ok(sameFestivalVibe(m.vibe, f.vibe), `${m.vibe} vs ${f.vibe}`);
  }
});

test('computeFestivalPairs: 무드 교차(1-2)로 전원 매칭', () => {
  const males = [team(1, 'M', 1, '도란'), team(2, 'M', 1, '도란')];
  const females = [team(3, 'F', 1, '시끌'), team(4, 'F', 1, '시끌')];
  const r = computeFestivalPairs(males, females);
  assert.equal(r.ok, true);
  assert.equal(r.pairedCount, 2);
  assert.equal(r.unmatchedMale, 0);
});

test('computeFestivalPairs: 불균형 시 ok=false', () => {
  const r = computeFestivalPairs([team(1, 'M', 1, '도란')], []);
  assert.equal(r.ok, false);
  assert.equal(r.validation.code, 'FESTIVAL_GENDER_TEAM_IMBALANCE');
});
