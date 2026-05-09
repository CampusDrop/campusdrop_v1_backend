const test = require('node:test');
const assert = require('node:assert/strict');

const {
  adjectives,
  bioNouns,
  insertSpaceIntoLegacyNickname,
} = require('../lib/nickname');

test('adjectives와 bioNouns 모두 비어있지 않아야 한다', () => {
  assert.ok(adjectives.length > 0, 'adjectives는 최소 1개 이상');
  assert.ok(bioNouns.length > 0, 'bioNouns는 최소 1개 이상');
});

test('insertSpaceIntoLegacyNickname: 띄어쓰기 없는 형용사+명사 → 사이에 공백', () => {
  const got = insertSpaceIntoLegacyNickname('부지런한꿀벌');
  assert.equal(got, '부지런한 꿀벌');
});

test('insertSpaceIntoLegacyNickname: #1234 suffix를 보존한다', () => {
  const got = insertSpaceIntoLegacyNickname('부지런한꿀벌#0734');
  assert.equal(got, '부지런한 꿀벌#0734');
});

test('insertSpaceIntoLegacyNickname: 이미 띄어쓰기가 있으면 null', () => {
  const got = insertSpaceIntoLegacyNickname('부지런한 꿀벌');
  assert.equal(got, null);
});

test('insertSpaceIntoLegacyNickname: 사전에 없는 닉네임이면 null', () => {
  const got = insertSpaceIntoLegacyNickname('홍길동');
  assert.equal(got, null);
});

test('insertSpaceIntoLegacyNickname: 가장 긴 prefix(형용사) 매칭을 우선한다', () => {
  // adjectives에는 "노란"과 "황금빛"이 모두 있음. "노란꿀벌"는 "노란"으로 분리되어야 함.
  const got = insertSpaceIntoLegacyNickname('노란꿀벌');
  assert.equal(got, '노란 꿀벌');
});

test('insertSpaceIntoLegacyNickname: 빈 문자열/비문자열 입력은 null', () => {
  assert.equal(insertSpaceIntoLegacyNickname(''), null);
  assert.equal(insertSpaceIntoLegacyNickname('   '), null);
  // @ts-expect-error 의도적으로 잘못된 입력
  assert.equal(insertSpaceIntoLegacyNickname(null), null);
  // @ts-expect-error 의도적으로 잘못된 입력
  assert.equal(insertSpaceIntoLegacyNickname(undefined), null);
  // @ts-expect-error 의도적으로 잘못된 입력
  assert.equal(insertSpaceIntoLegacyNickname(123), null);
});
