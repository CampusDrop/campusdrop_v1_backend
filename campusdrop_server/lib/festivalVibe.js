'use strict';

/**
 * 축제 무드 매칭용 정규화 키. `도란도란` / `시끌벅적` 계열은 각각 하나의 키로 묶습니다.
 * @param {unknown} vibe
 * @returns {string}
 */
function normalizeFestivalVibeKey(vibe) {
  const s = String(vibe ?? '').trim();
  if (!s) return '';
  if (/도란/.test(s)) return 'doran';
  if (/시끌/.test(s)) return 'sikul';
  return s.toLowerCase();
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function sameFestivalVibe(a, b) {
  const ka = normalizeFestivalVibeKey(a);
  const kb = normalizeFestivalVibeKey(b);
  return ka !== '' && ka === kb;
}

module.exports = { normalizeFestivalVibeKey, sameFestivalVibe };
