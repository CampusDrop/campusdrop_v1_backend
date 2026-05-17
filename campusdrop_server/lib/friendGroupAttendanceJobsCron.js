const cron = require('node-cron');
const {
  runFriendGroupAttendanceDeadlineJob,
  runFriendGroupMatchSuccessScheduledSendJob,
} = require('./friendGroupMatchSuccessFriendTalk');
const {
  runRomanceMondayRsvpDeadlineJob,
  runRomanceMondayOutcomeScheduledSendJob,
} = require('./friendTalkRsvp');

function cronDisabledFlag(v) {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/** 매일 KST 23:00 — 소그룹 초대 당일 마감 + 로맨스 7번 RSVP 당일 마감 */
async function runFriendGroupAttendanceDeadlineCronJob() {
  try {
    await runFriendGroupAttendanceDeadlineJob();
  } catch (err) {
    console.error('[friendGroupAttendanceDeadlineCron] job error', err);
  }
}

async function runRomanceMondayRsvpDeadlineCronJob() {
  try {
    await runRomanceMondayRsvpDeadlineJob();
  } catch (err) {
    console.error('[romanceMondayRsvpDeadlineCron] job error', err);
  }
}

function scheduleFriendGroupAttendanceDeadlineCron() {
  const fgOff = cronDisabledFlag(process.env.FRIEND_GROUP_ATTENDANCE_DEADLINE_CRON_DISABLED);
  const roOff = cronDisabledFlag(process.env.ROMANCE_MONDAY_RSVP_DEADLINE_CRON_DISABLED);
  if (fgOff && roOff) {
    console.log(
      '[attendanceDeadlineCron23h] 소그룹·로맨스 7번 마감 크론 모두 비활성화로 등록 생략',
    );
    return;
  }
  cron.schedule(
    '0 23 * * *',
    () => {
      const jobs = [];
      if (!fgOff) jobs.push(runFriendGroupAttendanceDeadlineCronJob());
      if (!roOff) jobs.push(runRomanceMondayRsvpDeadlineCronJob());
      Promise.all(jobs).catch((e) => console.error('[attendanceDeadlineCron23h] job error', e));
    },
    { timezone: 'Asia/Seoul' },
  );
  const parts = [];
  if (!fgOff) parts.push('소그룹 참석 마감');
  if (!roOff) parts.push('로맨스 7번 RSVP 마감');
  console.log(`[attendanceDeadlineCron23h] 등록됨: 매일 23:00 Asia/Seoul — ${parts.join(' + ')}`);
}

/** 매일 KST 08:01 — 전날 20:30 이후 확정분 예약 발송(소그룹 확정 안내 + 로맨스 7번 결과) */
async function runFriendGroupMatchSuccessScheduleCronJob() {
  try {
    await runFriendGroupMatchSuccessScheduledSendJob();
  } catch (err) {
    console.error('[friendGroupMatchSuccessScheduleCron] job error', err);
  }
}

async function runRomanceMondayOutcomeScheduleCronJob() {
  try {
    await runRomanceMondayOutcomeScheduledSendJob();
  } catch (err) {
    console.error('[romanceMondayOutcomeScheduleCron] job error', err);
  }
}

function scheduleFriendGroupMatchSuccessScheduledSendCron() {
  const fgOff = cronDisabledFlag(process.env.FRIEND_GROUP_MATCH_SUCCESS_SCHEDULE_CRON_DISABLED);
  const roOff = cronDisabledFlag(process.env.ROMANCE_MONDAY_OUTCOME_SCHEDULE_CRON_DISABLED);
  if (fgOff && roOff) {
    console.log(
      '[matchSuccessScheduleCron0801] 소그룹·로맨스 예약 발송 크론 모두 비활성화로 등록 생략',
    );
    return;
  }
  cron.schedule(
    '1 8 * * *',
    () => {
      const jobs = [];
      if (!fgOff) jobs.push(runFriendGroupMatchSuccessScheduleCronJob());
      if (!roOff) jobs.push(runRomanceMondayOutcomeScheduleCronJob());
      Promise.all(jobs).catch((e) => console.error('[matchSuccessScheduleCron0801] job error', e));
    },
    { timezone: 'Asia/Seoul' },
  );
  const parts = [];
  if (!fgOff) parts.push('소그룹 확정 안내(예약)');
  if (!roOff) parts.push('로맨스 7번 결과(예약)');
  console.log(
    `[matchSuccessScheduleCron0801] 등록됨: 매일 08:01 Asia/Seoul — ${parts.join(' + ')}`,
  );
}

module.exports = {
  scheduleFriendGroupAttendanceDeadlineCron,
  scheduleFriendGroupMatchSuccessScheduledSendCron,
  runFriendGroupAttendanceDeadlineCronJob,
  runFriendGroupMatchSuccessScheduleCronJob,
  runRomanceMondayRsvpDeadlineCronJob,
  runRomanceMondayOutcomeScheduleCronJob,
};
