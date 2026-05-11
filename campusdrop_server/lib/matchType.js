const MATCH_TYPE_ROMANCE = 'ROMANCE';
const MATCH_TYPE_FRIEND = 'FRIEND';

const MATCH_TYPES = new Set([MATCH_TYPE_ROMANCE, MATCH_TYPE_FRIEND]);

/**
 * @param {unknown} value
 * @returns {'ROMANCE' | 'FRIEND' | null}
 */
function normalizeMatchType(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toUpperCase();
  if (v === MATCH_TYPE_ROMANCE || v === MATCH_TYPE_FRIEND) {
    return v;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {'ROMANCE' | 'FRIEND'}
 */
function resolveMatchTypeOrDefault(value) {
  return normalizeMatchType(value) || MATCH_TYPE_ROMANCE;
}

module.exports = {
  MATCH_TYPE_ROMANCE,
  MATCH_TYPE_FRIEND,
  MATCH_TYPES,
  normalizeMatchType,
  resolveMatchTypeOrDefault,
};
