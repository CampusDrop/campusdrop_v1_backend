'use strict';

const { prisma } = require('./prisma');
const { decryptPhoneFromStorage } = require('./phoneCrypto');
const { assertSolapiFriendTalkEnv, sendFriendTalkCta } = require('./solapiFriendTalkSend');
const templates = require('./friendTalkTemplates');
const { resolveFriendGroupMeetingDisplay } = require('./meetingDisplay');
const { getMatchingPeriodStart } = require('./matchPolicy');
const {
  attendanceDeadlineUtcForInviteDay,
  matchSuccessSendPlanFromResolvedAt,
} = require('./friendGroupAttendanceSchedule');

const RSVP_YES = 'YES';
const RSVP_NO = 'NO';

/** @see friendTalkRsvp FRIEND_GROUP_QUORUM_YES */
const FRIEND_GROUP_QUORUM_YES = 3;

/**
 * @param {string} identityId
 * @returns {Promise<string | null>}
 */
async function decryptPhoneForIdentity(identityId) {
  const row = await prisma.identity.findUnique({
    where: { id: identityId },
    select: { phoneEncrypted: true, blockedAt: true },
  });
  if (!row || row.blockedAt || !row.phoneEncrypted) {
    return null;
  }
  try {
    return decryptPhoneFromStorage(row.phoneEncrypted);
  } catch (_) {
    return null;
  }
}

/**
 * @param {Date} periodStart
 */
async function friendGroupMatchingsForPeriod(periodStart) {
  return prisma.friendGroupMatching.findMany({
    where: { periodStart },
    select: { id: true },
  });
}

/**
 * YES ≥ 최소 인원 자에게만 확정 안내 친구톡 (멤버별 미발송만)
 * @param {string} friendGroupMatchingId
 * @returns {Promise<boolean>} 발송 시도까지 했고 정상 완료로 스케줄을 지워도 될 때 true
 */
async function deliverFriendGroupMatchSuccessMessages(friendGroupMatchingId) {
  const group = await prisma.friendGroupMatching.findUnique({
    where: { id: friendGroupMatchingId },
    include: {
      members: {
        include: {
          identity: { select: { blockedAt: true } },
        },
      },
    },
  });
  if (!group) {
    return false;
  }

  const yesMembers = group.members.filter((m) => m.attendanceRsvp === RSVP_YES);
  if (yesMembers.length < FRIEND_GROUP_QUORUM_YES) {
    return false;
  }

  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    console.warn('[friendGroupMatchSuccess] Solapi 미설정:', missingEnv);
    return false;
  }

  const display = await resolveFriendGroupMeetingDisplay(friendGroupMatchingId);
  if (!display.found || !display.meetingTime || !display.meetingPlace) {
    return false;
  }

  const text = templates.buildFriendGroupMatchCompleteText(display.meetingTime, display.meetingPlace);

  for (const m of yesMembers) {
    if (m.matchSuccessFriendTalkSentAt) {
      continue;
    }
    if (m.identity.blockedAt) {
      continue;
    }
    const phone = await decryptPhoneForIdentity(m.identityId);
    if (!phone) {
      console.warn('[friendGroupMatchSuccess] 전화 없음', friendGroupMatchingId, m.identityId);
      continue;
    }
    try {
      await sendFriendTalkCta({ to: phone, text });
      await prisma.friendGroupMember.update({
        where: {
          friendGroupMatchingId_identityId: {
            friendGroupMatchingId: group.id,
            identityId: m.identityId,
          },
        },
        data: { matchSuccessFriendTalkSentAt: new Date() },
      });
    } catch (err) {
      console.error(
        '[friendGroupMatchSuccess] 발송 실패',
        friendGroupMatchingId,
        m.identityId,
        err && err.message,
      );
    }
  }
  return true;
}

/**
 * 전원 응답(또는 마감 시 미응답 NO) 후 YES ≥ 3이면 확정 안내 —
 * KST 20:30 미만이면 즉시, 이후면 `match_success_scheduled_send_at` = 익일 KST 08:01.
 * @param {string} friendGroupMatchingId
 */
async function evaluateFriendGroupAttendanceResolution(friendGroupMatchingId) {
  const now = new Date();
  const groupRow = await prisma.friendGroupMatching.findUnique({
    where: { id: friendGroupMatchingId },
    select: {
      id: true,
      attendanceDueAt: true,
      attendanceResolvedAt: true,
      matchSuccessScheduledSendAt: true,
    },
  });
  if (!groupRow) {
    return;
  }

  if (groupRow.attendanceResolvedAt) {
    return;
  }

  if (groupRow.attendanceDueAt && now.getTime() >= groupRow.attendanceDueAt.getTime()) {
    await prisma.friendGroupMember.updateMany({
      where: {
        friendGroupMatchingId,
        attendanceRsvp: null,
      },
      data: { attendanceRsvp: RSVP_NO },
    });
  }

  const members = await prisma.friendGroupMember.findMany({
    where: { friendGroupMatchingId },
    select: { attendanceRsvp: true },
  });
  const pending = members.some((m) => m.attendanceRsvp == null);
  if (pending) {
    return;
  }

  const yesCount = members.filter((m) => m.attendanceRsvp === RSVP_YES).length;
  const resolvedAt = now;

  if (yesCount < FRIEND_GROUP_QUORUM_YES) {
    await prisma.friendGroupMatching.update({
      where: { id: friendGroupMatchingId },
      data: {
        attendanceResolvedAt: resolvedAt,
        matchSuccessScheduledSendAt: null,
      },
    });
    return;
  }

  const plan = matchSuccessSendPlanFromResolvedAt(resolvedAt);

  if (plan.mode === 'immediate') {
    const ok = await deliverFriendGroupMatchSuccessMessages(friendGroupMatchingId);
    if (!ok) {
      return;
    }
    await prisma.friendGroupMatching.update({
      where: { id: friendGroupMatchingId },
      data: {
        attendanceResolvedAt: resolvedAt,
        matchSuccessScheduledSendAt: null,
      },
    });
    return;
  }

  await prisma.friendGroupMatching.update({
    where: { id: friendGroupMatchingId },
    data: {
      attendanceResolvedAt: resolvedAt,
      matchSuccessScheduledSendAt: plan.scheduledAt,
    },
  });
}

/**
 * `match_success_scheduled_send_at` 도달 시 — 익일 08:01 등
 */
async function runFriendGroupMatchSuccessScheduledSendJob() {
  const now = new Date();
  const rows = await prisma.friendGroupMatching.findMany({
    where: {
      matchSuccessScheduledSendAt: { lte: now },
    },
    select: { id: true },
  });
  for (const r of rows) {
    try {
      const ok = await deliverFriendGroupMatchSuccessMessages(r.id);
      if (ok) {
        await prisma.friendGroupMatching.update({
          where: { id: r.id },
          data: { matchSuccessScheduledSendAt: null },
        });
      } else {
        console.warn('[friendGroupMatchSuccessScheduledSend] 발송 스킵·실패 — 스케줄 유지', r.id);
      }
    } catch (e) {
      console.error('[friendGroupMatchSuccessScheduledSend]', r.id, e && e.message);
    }
  }
}

/**
 * 참석 마감(KST 당일 23:00) — 미응답 NO 후 evaluate
 */
async function runFriendGroupAttendanceDeadlineJob() {
  const now = new Date();
  const rows = await prisma.friendGroupMatching.findMany({
    where: {
      attendanceDueAt: { lte: now },
      attendanceResolvedAt: null,
    },
    select: { id: true },
  });
  for (const r of rows) {
    try {
      await evaluateFriendGroupAttendanceResolution(r.id);
    } catch (e) {
      console.error('[friendGroupAttendanceDeadline]', r.id, e && e.message);
    }
  }
}

/**
 * 소그룹 멤버에게 참석 확인 친구톡(버튼). `PUBLIC_API_URL`·RSVP 링크 필요.
 * @param {string} friendGroupMatchingId
 */
async function sendFriendGroupAttendanceInviteForGroup(friendGroupMatchingId) {
  const missingEnv = assertSolapiFriendTalkEnv();
  if (missingEnv) {
    return { ok: false, error: missingEnv, sent: 0, skipped: 0, failed: [] };
  }
  const { buildFriendGroupAttendButtons, publicApiBase } = require('./friendTalkRsvp');
  const base = publicApiBase();
  if (!base) {
    return { ok: false, error: '버튼 링크용 PUBLIC_API_URL 설정이 필요합니다.', sent: 0, skipped: 0, failed: [] };
  }

  const display = await resolveFriendGroupMeetingDisplay(friendGroupMatchingId);
  if (!display.found || !display.meetingTime || !display.meetingPlace) {
    return {
      ok: false,
      error: '매칭에 일시·장소가 없어 친구톡을 보낼 수 없습니다.',
      sent: 0,
      skipped: 0,
      failed: [],
    };
  }

  const text = templates.buildFriendGroupAttendanceInviteText(display.meetingTime, display.meetingPlace);

  let group = await prisma.friendGroupMatching.findUnique({
    where: { id: friendGroupMatchingId },
    include: {
      members: {
        orderBy: { sortOrder: 'asc' },
        include: {
          identity: { select: { id: true, blockedAt: true } },
        },
      },
    },
  });

  if (!group) {
    return {
      ok: false,
      error: '소그룹 매칭을 찾을 수 없습니다.',
      sent: 0,
      skipped: 0,
      failed: [],
    };
  }

  let sent = 0;
  let skipped = 0;
  /** @type {{ identityId: string, error: string }[]} */
  const failed = [];

  for (const m of group.members) {
    if (m.attendanceInviteSentAt) {
      skipped += 1;
      continue;
    }
    if (m.identity.blockedAt) {
      skipped += 1;
      continue;
    }
    const phone = await decryptPhoneForIdentity(m.identityId);
    if (!phone) {
      failed.push({ identityId: m.identityId, error: '전화번호 없음 또는 복호화 실패' });
      continue;
    }
    let buttons;
    try {
      buttons = await buildFriendGroupAttendButtons(group.id, m.identityId, base);
    } catch (e) {
      failed.push({
        identityId: m.identityId,
        error: e && e.message ? String(e.message) : 'RSVP 버튼 생성 실패',
      });
      continue;
    }
    try {
      await sendFriendTalkCta({ to: phone, text, buttons });
      await prisma.friendGroupMember.update({
        where: {
          friendGroupMatchingId_identityId: {
            friendGroupMatchingId: group.id,
            identityId: m.identityId,
          },
        },
        data: { attendanceInviteSentAt: new Date() },
      });
      sent += 1;
      if (sent === 1 && !group.attendanceDueAt) {
        const due = attendanceDeadlineUtcForInviteDay(new Date());
        if (due) {
          await prisma.friendGroupMatching.update({
            where: { id: group.id },
            data: { attendanceDueAt: due },
          });
          group = { ...group, attendanceDueAt: due };
        }
      }
    } catch (err) {
      failed.push({
        identityId: m.identityId,
        error: err && err.message ? String(err.message) : 'Solapi 발송 실패',
      });
    }
  }

  return { ok: true, sent, skipped, failed };
}

/**
 * @param {{ periodStart?: Date }} [opts]
 */
async function sendFriendGroupAttendanceInviteForAllInPeriod(opts = {}) {
  const periodStart = opts.periodStart || getMatchingPeriodStart();
  const rows = await friendGroupMatchingsForPeriod(periodStart);
  /** @type {{ friendGroupMatchingId: string, reason: string }[]} */
  const groupFailed = [];
  let sentMembers = 0;
  let skippedMembers = 0;
  /** @type {{ friendGroupMatchingId: string, identityId: string, error: string }[]} */
  const memberFailed = [];

  for (const row of rows) {
    const r = await sendFriendGroupAttendanceInviteForGroup(row.id);
    if (!r.ok) {
      groupFailed.push({ friendGroupMatchingId: row.id, reason: r.error || 'unknown' });
    }
    sentMembers += r.sent;
    skippedMembers += r.skipped;
    for (const f of r.failed) {
      memberFailed.push({
        friendGroupMatchingId: row.id,
        identityId: f.identityId,
        error: f.error,
      });
    }
  }

  return {
    groupCount: rows.length,
    sentMembers,
    skippedMembers,
    groupFailed,
    memberFailed,
    periodStart: periodStart.toISOString(),
  };
}

module.exports = {
  FRIEND_GROUP_QUORUM_YES,
  evaluateFriendGroupAttendanceResolution,
  deliverFriendGroupMatchSuccessMessages,
  runFriendGroupAttendanceDeadlineJob,
  runFriendGroupMatchSuccessScheduledSendJob,
  sendFriendGroupAttendanceInviteForGroup,
  sendFriendGroupAttendanceInviteForAllInPeriod,
};
