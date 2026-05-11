const express = require('express');
const {
  parseRsvpToken,
  resolveFriendTalkRsvpLink,
  handleRsvpClick,
} = require('../lib/friendTalkRsvp');

const router = express.Router();

async function handleParsedRsvp(parsed, res) {
  if (!parsed.ok) {
    return res.status(400).type('html')
      .send(`<!DOCTYPE html><html><body><p>${parsed.error}</p></body></html>`);
  }
  const { matchingId, identityId, phase, choice } = parsed.data;
  try {
    const result = await handleRsvpClick({ matchingId, identityId, phase, choice });
    if (!result.ok) {
      return res.status(400).type('html')
        .send(`<!DOCTYPE html><html><body><p>${result.error}</p></body></html>`);
    }
  } catch (e) {
    console.error('friend-talk rsvp', e);
    return res.status(500).type('html')
      .send('<!DOCTYPE html><html lang="ko"><body><p>처리 중 오류가 발생했습니다.</p></body></html>');
  }
  return res.status(200).type('html')
    .send('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>Campus Drop</title></head><body><p>응답이 저장되었습니다.</p></body></html>');
}

router.get('/r/:code', async (req, res) => {
  const code = typeof req.params.code === 'string' ? req.params.code.trim() : '';
  try {
    const parsed = await resolveFriendTalkRsvpLink(code);
    return handleParsedRsvp(parsed, res);
  } catch (e) {
    console.error('friend-talk short rsvp', e);
    return res.status(500).type('html')
      .send('<!DOCTYPE html><html lang="ko"><body><p>처리 중 오류가 발생했습니다.</p></body></html>');
  }
});

router.get('/rsvp', async (req, res) => {
  const t = typeof req.query.t === 'string' ? req.query.t.trim() : '';
  if (!t) {
    return res.status(400).type('html')
      .send('<!DOCTYPE html><html><body><p>링크가 올바르지 않습니다.</p></body></html>');
  }
  const parsed = parseRsvpToken(t);
  return handleParsedRsvp(parsed, res);
});

module.exports = router;
