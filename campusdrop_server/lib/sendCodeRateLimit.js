/**
 * 이메일 인증번호 발송 레이트리밋 (이메일 단위, 프로세스 메모리)
 *
 * 정책
 *  - 1·2·3번째 발송 사이에는 SHORT_COOLDOWN_MS(10초) 이상 간격 필요
 *  - 4번째 이후 발송에는 LONG_COOLDOWN_MS(10분) 이상 간격 필요
 *  - 마지막 발송으로부터 ENTRY_TTL_MS(1시간) 이상 지나면 카운터 리셋
 *  - `clearSendCodeRate(email)`로 인증 성공 시 외부에서 직접 리셋 가능
 *
 * 한계: verificationCodes.js와 마찬가지로 프로세스 메모리이며 재시작 시 소실됩니다.
 */

const SHORT_COOLDOWN_MS = 10 * 1000;
const LONG_COOLDOWN_MS = 10 * 60 * 1000;
/** N번째 발송이 이 값을 초과하면(즉 4번째 이상) LONG 쿨다운을 적용합니다. */
const SHORT_COOLDOWN_MAX_COUNT = 3;
const ENTRY_TTL_MS = 60 * 60 * 1000;

/** @typedef {{ count: number, lastSentAt: number }} SendCodeRateEntry */
/** @type {Map<string, SendCodeRateEntry>} */
const store = new Map();

/**
 * @param {string} email
 * @returns {SendCodeRateEntry | null}
 */
function getActiveEntry(email) {
  const entry = store.get(email);
  if (!entry) return null;
  if (Date.now() - entry.lastSentAt > ENTRY_TTL_MS) {
    store.delete(email);
    return null;
  }
  return entry;
}

/**
 * 다음 발송에 적용할 쿨다운(ms). 직전 발송이 N회였다면 (N+1)번째 발송에 적용됩니다.
 * @param {number} previousCount
 */
function cooldownForNextSend(previousCount) {
  return previousCount >= SHORT_COOLDOWN_MAX_COUNT ? LONG_COOLDOWN_MS : SHORT_COOLDOWN_MS;
}

/**
 * 발송 가능 여부 확인. 가능하면 `{ ok: true }`, 아니면 남은 대기 시간을 반환합니다.
 * @param {string} email
 * @returns {{ ok: true } | { ok: false, retryAfterMs: number, cooldownMs: number, count: number }}
 */
function checkSendCodeAllowed(email) {
  const entry = getActiveEntry(email);
  if (!entry) return { ok: true };
  const cooldownMs = cooldownForNextSend(entry.count);
  const elapsed = Date.now() - entry.lastSentAt;
  if (elapsed >= cooldownMs) return { ok: true };
  return {
    ok: false,
    retryAfterMs: cooldownMs - elapsed,
    cooldownMs,
    count: entry.count,
  };
}

/**
 * 발송 성공을 기록합니다(카운터 +1, lastSentAt 갱신).
 * @param {string} email
 * @returns {{ count: number }}
 */
function recordSendCode(email) {
  const entry = getActiveEntry(email);
  const now = Date.now();
  if (!entry) {
    store.set(email, { count: 1, lastSentAt: now });
    return { count: 1 };
  }
  entry.count += 1;
  entry.lastSentAt = now;
  return { count: entry.count };
}

/**
 * 인증 성공 등 외부 이벤트로 카운터를 즉시 리셋합니다.
 * @param {string} email
 */
function clearSendCodeRate(email) {
  store.delete(email);
}

module.exports = {
  checkSendCodeAllowed,
  recordSendCode,
  clearSendCodeRate,
  SHORT_COOLDOWN_MS,
  LONG_COOLDOWN_MS,
  SHORT_COOLDOWN_MAX_COUNT,
  ENTRY_TTL_MS,
};
