function intEnv(name, def) {
  const v = Number.parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

function bytesEnv(name, defBytes) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return defBytes;
  const m = /^(\d+)(kb|mb)?$/i.exec(raw.replace(/\s/g, ''));
  if (!m) return defBytes;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return defBytes;
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'kb') return n * 1024;
  if (unit === 'mb') return n * 1024 * 1024;
  return n;
}

/** 단일 JSON 본문 상한(바이트). `express.json({ limit })`에 전달. */
const jsonBodyLimitBytes = bytesEnv('ANALYTICS_JSON_BODY_MAX_BYTES', 512 * 1024);

/** 이벤트 배열 최대 개수(초과분은 dropped). */
const maxEventsPerRequest = intEnv('ANALYTICS_MAX_EVENTS_PER_REQUEST', 200);

/** 상호작용 배열 최대 개수. */
const maxInteractionsPerRequest = intEnv('ANALYTICS_MAX_INTERACTIONS_PER_REQUEST', 100);

/** 배치 items 최대 개수. */
const maxBatchItems = intEnv('ANALYTICS_MAX_BATCH_ITEMS', 50);

const rateWindowSec = intEnv('ANALYTICS_RATE_WINDOW_SEC', 60);

const limits = {
  eventsPerIpPerWindow: intEnv('ANALYTICS_EVENTS_PER_IP_PER_WINDOW', 200),
  eventsPerSessionPerWindow: intEnv('ANALYTICS_EVENTS_PER_SESSION_PER_WINDOW', 120),
  heartbeatPerIpPerWindow: intEnv('ANALYTICS_HEARTBEAT_PER_IP_PER_WINDOW', 300),
  heartbeatPerSessionPerWindow: intEnv('ANALYTICS_HEARTBEAT_PER_SESSION_PER_WINDOW', 200),
  interactionPerIpPerWindow: intEnv('ANALYTICS_INTERACTION_PER_IP_PER_WINDOW', 40),
  interactionPerSessionPerWindow: intEnv('ANALYTICS_INTERACTION_PER_SESSION_PER_WINDOW', 30),
  batchPerIpPerWindow: intEnv('ANALYTICS_BATCH_PER_IP_PER_WINDOW', 30),
  batchPerSessionPerWindow: intEnv('ANALYTICS_BATCH_PER_SESSION_PER_WINDOW', 20),
  interactionsPerSessionPerDay: intEnv('ANALYTICS_INTERACTIONS_PER_SESSION_PER_DAY', 8000),
};

module.exports = {
  intEnv,
  bytesEnv,
  jsonBodyLimitBytes,
  maxEventsPerRequest,
  maxInteractionsPerRequest,
  maxBatchItems,
  rateWindowSec,
  limits,
};
