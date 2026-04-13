'use strict';

const MAX_REASONS = 5;
const MIN_REASONS_BEFORE_FILL = 3;

/**
 * Python `match_report` 전체를 DB에 넣기 전 `{ score, reasons[] }` 형태로만 남긴다.
 * 이유는 최대 5개, 부족하면 요약·축·부분점수에서 보강(최소 3개까지 시도).
 *
 * @param {number} score `matchings.score`와 동일한 최종 점수
 * @param {Record<string, unknown> | null | undefined} full Python `match_report`
 * @returns {{ score: number, reasons: string[] } | null}
 */
function slimMatchReportForDb(score, full) {
  if (full == null || typeof full !== 'object') return null;

  const reasons = [];
  const seen = new Set();

  const push = (s) => {
    if (typeof s !== 'string') return;
    const t = s.trim();
    if (t.length === 0 || t.length > 600) return;
    const key = t.slice(0, 100);
    if (seen.has(key)) return;
    seen.add(key);
    reasons.push(t);
  };

  const numbered = full.reasons_numbered_ko;
  if (Array.isArray(numbered)) {
    for (const line of numbered) {
      push(String(line));
      if (reasons.length >= MAX_REASONS) {
        return pack(score, reasons);
      }
    }
  }

  if (reasons.length < MIN_REASONS_BEFORE_FILL) {
    if (typeof full.summary_text === 'string') {
      push(full.summary_text);
    }
    const axes = full.continuous_axes_ranked_desc;
    if (Array.isArray(axes)) {
      for (const ax of axes) {
        if (reasons.length >= MAX_REASONS) break;
        if (!ax || typeof ax !== 'object') continue;
        const label = ax.label_ko != null ? String(ax.label_ko) : String(ax.field || '');
        const m = ax.axis_match_0_100;
        push(`「${label}」정렬도 ${m}/100 (응답 A=${ax.value_A}, B=${ax.value_B}).`);
      }
    }
    const comps = full.group_a_component_scores_ranked_desc;
    if (Array.isArray(comps) && reasons.length < MAX_REASONS) {
      for (const c0 of comps) {
        if (reasons.length >= MAX_REASONS) break;
        if (!c0 || typeof c0 !== 'object') continue;
        const lab = c0.label_ko != null ? String(c0.label_ko) : String(c0.key || '');
        push(`${lab} ${c0.score_0_100}점.`);
      }
    }
  }

  if (reasons.length === 0) {
    push('설문 기반 궁합 점수로 매칭되었습니다.');
  }

  return pack(score, reasons.slice(0, MAX_REASONS));
}

/**
 * @param {number} score
 * @param {string[]} reasons
 */
function pack(score, reasons) {
  const n = typeof score === 'number' && Number.isFinite(score) ? score : Number(score);
  const s = Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  return { score: s, reasons: reasons.slice(0, MAX_REASONS) };
}

module.exports = { slimMatchReportForDb, MAX_REASONS };
