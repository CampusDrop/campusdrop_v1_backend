'use strict';

/**
 * 설문·Trait 컬럼용 성별 정규화. 이성 매칭은 남성(male)·여성(female)만 고려한다.
 * @param {unknown} value
 * @returns {'male' | 'female' | null}
 */
function normalizeTraitGender(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().toLowerCase();
  if (!s) return null;
  if (['male', 'm', 'man', '남', '남성', '남자'].includes(s)) return 'male';
  if (['female', 'f', 'woman', '여', '여성', '여자'].includes(s)) return 'female';
  return null;
}

/** 배치·실시간 매칭 대상: 남/여만 */
function isBinaryTraitGender(value) {
  return normalizeTraitGender(value) !== null;
}

/** 이성(남+여) 쌍인지 */
function areOppositeTraitGenders(a, b) {
  const x = normalizeTraitGender(a);
  const y = normalizeTraitGender(b);
  if (x === null || y === null) return false;
  return x !== y;
}

/** UI용 짧은 라벨 */
function traitGenderLabelKo(value) {
  const x = normalizeTraitGender(value);
  if (x === 'male') return '남성';
  if (x === 'female') return '여성';
  return '';
}

module.exports = {
  normalizeTraitGender,
  isBinaryTraitGender,
  areOppositeTraitGenders,
  traitGenderLabelKo,
};
