const { getMatchingPeriodStart, getMatchingPeriodEnd } = require('./matchPolicy');

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const KST_OFFSET_MS = 9 * MS_PER_HOUR;
const APPLICATION_CLOSE_DAY_OFFSET = 5; // Tue 00:00 + 5 days = Sunday.
const APPLICATION_CLOSE_HOUR_KST = 18;
const TARGET_DATE_COUNT = 6; // Tuesday through Sunday.

const DAY_LABELS_KO = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** @param {Date} date */
function formatKstDateOnly(date) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** @param {Date} date */
function kstDayIndex(date) {
  return new Date(date.getTime() + KST_OFFSET_MS).getUTCDay();
}

/** @param {Date} date */
function serializeDateTime(date) {
  return date.toISOString();
}

/** @param {Date} date */
function buildDateOption(date) {
  const day = kstDayIndex(date);
  return {
    date: formatKstDateOnly(date),
    dayOfWeek: DAY_CODES[day],
    dayOfWeekKo: DAY_LABELS_KO[day],
  };
}

/**
 * 신청 주기는 화 00:00(KST)에 열리고 일 18:00(KST)에 닫힌다.
 * 신청하는 날짜 선택지는 다음 매칭 주의 화~일이다.
 * @param {Date} [now]
 */
function buildSurveyAvailabilityWindow(now = new Date()) {
  const applicationOpensAt = getMatchingPeriodStart(now);
  const applicationClosesAt = new Date(
    applicationOpensAt.getTime() +
      APPLICATION_CLOSE_DAY_OFFSET * MS_PER_DAY +
      APPLICATION_CLOSE_HOUR_KST * MS_PER_HOUR,
  );
  const nextApplicationOpensAt = getMatchingPeriodEnd(applicationOpensAt);
  const targetPeriodStart = nextApplicationOpensAt;
  const targetPeriodEnd = getMatchingPeriodEnd(targetPeriodStart);
  const dates = Array.from({ length: TARGET_DATE_COUNT }, (_, i) =>
    buildDateOption(new Date(targetPeriodStart.getTime() + i * MS_PER_DAY)),
  );
  const isOpen = now.getTime() >= applicationOpensAt.getTime() && now.getTime() < applicationClosesAt.getTime();

  return {
    timezone: 'Asia/Seoul',
    now: serializeDateTime(now),
    isOpen,
    application: {
      opensAt: serializeDateTime(applicationOpensAt),
      closesAt: serializeDateTime(applicationClosesAt),
      nextOpensAt: serializeDateTime(nextApplicationOpensAt),
    },
    target: {
      periodStart: serializeDateTime(targetPeriodStart),
      periodEnd: serializeDateTime(targetPeriodEnd),
      dates,
    },
  };
}

/**
 * @param {Array<{ date: string }>} availability
 * @param {Date} [now]
 * @returns {{ ok: true, window: ReturnType<typeof buildSurveyAvailabilityWindow> } | { ok: false, status: number, error: string, window: ReturnType<typeof buildSurveyAvailabilityWindow> }}
 */
function validateSurveyAvailabilityForCurrentWindow(availability, now = new Date()) {
  const window = buildSurveyAvailabilityWindow(now);
  if (!window.isOpen) {
    return {
      ok: false,
      status: 403,
      error: '현재는 매칭 신청 기간이 아닙니다. 신청은 매주 화요일 00:00부터 일요일 18:00(KST)까지 가능합니다.',
      window,
    };
  }

  const allowedDates = new Set(window.target.dates.map((d) => d.date));
  const invalid = Array.isArray(availability)
    ? availability.map((slot) => slot?.date).filter((date) => !allowedDates.has(String(date)))
    : [];
  if (invalid.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `availability 날짜는 다음 중 하나여야 합니다: ${[...allowedDates].join(', ')}`,
      window,
    };
  }

  return { ok: true, window };
}

module.exports = {
  buildSurveyAvailabilityWindow,
  validateSurveyAvailabilityForCurrentWindow,
};
