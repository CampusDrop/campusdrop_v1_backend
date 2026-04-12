/**
 * Python 매칭 API URL. 베이스는 반드시 `MATCHING_SERVICE_URL`에서만 가져옵니다.
 */

function requireMatchingServiceBaseRaw() {
  const raw = (process.env.MATCHING_SERVICE_URL || '').trim();
  if (!raw) {
    throw new Error(
      'MATCHING_SERVICE_URL 환경 변수를 설정해 주세요. 예: https://matching.internal:8000 또는 http://matching:8000',
    );
  }
  return raw;
}

/**
 * Python 매칭 API POST URL.
 * - `MATCHING_SERVICE_URL`이 경로를 포함하면(예: …/calculate-match) 그대로 사용.
 * - 베이스만이면 `MATCHING_CALCULATE_PATH`(기본 /calculate-match)를 붙임.
 */
function getMatchingCalculateMatchUrl() {
  const pathDefault = '/calculate-match';
  const envPath = (process.env.MATCHING_CALCULATE_PATH || pathDefault).trim();
  const normalizedPath = envPath.startsWith('/') ? envPath : `/${envPath}`;

  const raw = requireMatchingServiceBaseRaw();

  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    const u = new URL(withProto);
    const hasPath = u.pathname.length > 1;
    if (hasPath) {
      return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
    }
    return `${u.origin.replace(/\/+$/, '')}${normalizedPath}`;
  } catch {
    const base = raw.replace(/\/+$/, '');
    return `${base}${normalizedPath}`;
  }
}

/**
 * Python 배치 매칭 API POST URL.
 * - 베이스는 `MATCHING_SERVICE_URL`에서만 추출하고 `MATCHING_BATCH_PATH`(기본 `/batch-match`)를 붙임.
 */
function getMatchingBatchMatchUrl() {
  const pathDefault = '/batch-match';
  const envPath = (process.env.MATCHING_BATCH_PATH || pathDefault).trim();
  const normalizedPath = envPath.startsWith('/') ? envPath : `/${envPath}`;

  const raw = requireMatchingServiceBaseRaw();

  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    const u = new URL(withProto);
    const origin = u.origin.replace(/\/+$/, '');
    return `${origin}${normalizedPath}`;
  } catch {
    const base = raw.replace(/\/+$/, '');
    return `${base}${normalizedPath}`;
  }
}

module.exports = {
  getMatchingCalculateMatchUrl,
  getMatchingBatchMatchUrl,
};
