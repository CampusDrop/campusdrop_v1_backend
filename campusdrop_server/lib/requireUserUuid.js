const { prisma } = require('./prisma');
const { writeAccessLog } = require('./accessLog');

const UUID_HEADER = 'x-user-uuid';

const AUTH_EXPIRED = {
  error: '인증이 만료되었습니다. 다시 이메일 인증을 해주세요.',
};

/**
 * `x-user-uuid` = `Identity.id`. 성공 시 `req.user`에 Identity(+trait)를 넣습니다.
 */
async function requireUserUuid(req, res, next) {
  const raw = req.headers[UUID_HEADER];
  const token = typeof raw === 'string' ? raw.trim() : '';

  if (!token) {
    return res.status(401).json(AUTH_EXPIRED);
  }

  try {
    const identity = await prisma.identity.findUnique({
      where: { id: token },
      include: { trait: true },
    });

    if (!identity) {
      return res.status(401).json(AUTH_EXPIRED);
    }

    if (identity.blockedAt) {
      return res.status(403).json({
        error: '이 계정은 이용이 제한되었습니다. 문의가 필요하면 운영팀에 연락해 주세요.',
      });
    }

    req.user = identity;

    await writeAccessLog({
      actorType: 'user_session',
      actorId: identity.id,
      action: 'AUTH_SESSION_VALIDATE',
      resource: `${req.method} ${req.originalUrl || req.url}`,
      ip: req.ip || null,
      userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
      metadata: { path: req.path },
    });

    next();
  } catch (err) {
    console.error('requireUserUuid error:', err);
    return res.status(500).json({ error: '인증 확인 중 오류가 발생했습니다.' });
  }
}

module.exports = { requireUserUuid };
