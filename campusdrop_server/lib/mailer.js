const nodemailer = require('nodemailer');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
const { TTL_MINUTES } = require('./verificationCodes');

const SUBJECT = '[Campus Drop] 이메일 인증 번호';

const DEFAULT_SES_FROM_DISPLAY_NAME = 'Campus Drop';

/** 로고 보라 + 라벤더 배경 (assets/logo.png 톤에 맞춤) */
const BRAND_PRIMARY = '#6E68E7';
const BRAND_PRIMARY_DEEP = '#5348d9';
const BRAND_PAGE_BG = '#eef0fb';
const BRAND_CARD = '#ffffff';
const BRAND_HEADING = '#1e1b4b';
const BRAND_MUTED = '#64748b';
const BRAND_BORDER = '#e2e8f0';

/** RFC 5322 From: 표시 이름 + 주소 (학교 메일 등에서 공식 발신처로 보이도록 기본값 사용). */
function sesFromEmailAddress() {
  const email = String(process.env.SES_FROM_EMAIL || '').trim();
  if (!email) return null;
  const name =
    String(process.env.SES_FROM_DISPLAY_NAME || '').trim() ||
    DEFAULT_SES_FROM_DISPLAY_NAME;
  return `${name} <${email}>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 인증 메일 상단 로고. `EMAIL_LOGO_URL` 우선, 없으면 `PUBLIC_API_URL` + `/assets/logo.png`.
 * @returns {string}
 */
function resolveEmailLogoUrl() {
  const explicit = String(process.env.EMAIL_LOGO_URL || '').trim();
  if (explicit) return explicit;
  const base = String(process.env.PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
  if (base) return `${base}/assets/logo.png`;
  return '';
}

/**
 * @param {string} code
 * @returns {{ text: string, html: string }}
 */
function buildBodies(code) {
  const safe = escapeHtml(code);
  const logoUrl = resolveEmailLogoUrl();
  const preheader = `인증 번호 ${code} · ${TTL_MINUTES}분간 유효합니다.`;

  const text = [
    'Campus Drop — 이메일 인증',
    '',
    `인증 번호: ${code}`,
    '',
    `위 번호는 ${TTL_MINUTES}분간 유효합니다.`,
    '본인이 요청하지 않았다면 이 메일을 무시해 주세요.',
  ].join('\n');

  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="112" alt="Campus Drop" style="display:block;width:112px;max-width:100%;height:auto;margin:0 auto;border:0;" />`
    : `<p style="margin:0;font-family:'Nunito','Noto Sans KR',-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;font-size:28px;font-weight:800;letter-spacing:-0.03em;color:${BRAND_PRIMARY};line-height:1.2;">Campus Drop</p>`;

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta http-equiv="x-ua-compatible" content="ie=edge" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Noto+Sans+KR:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <title>${escapeHtml(SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND_PAGE_BG};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:transparent;width:0;height:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BRAND_PAGE_BG};">
    <tr>
      <td align="center" style="padding:40px 16px;font-family:'Nunito','Noto Sans KR',-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic','Apple SD Gothic Neo',sans-serif;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;background:${BRAND_CARD};border-radius:20px;border:1px solid ${BRAND_BORDER};overflow:hidden;">
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,${BRAND_PRIMARY} 0%,${BRAND_PRIMARY_DEEP} 100%);background-color:${BRAND_PRIMARY};font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td align="center" style="padding:36px 32px 20px;">${logoBlock}</td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 8px;">
              <h1 style="margin:0;font-size:22px;font-weight:800;color:${BRAND_HEADING};letter-spacing:-0.02em;">이메일 인증</h1>
              <p style="margin:14px 0 0;font-size:15px;font-weight:500;line-height:1.55;color:${BRAND_MUTED};">아래 인증 번호를 앱 또는 웹 화면에 입력해 주세요.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 32px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td align="center" style="background-color:${BRAND_PRIMARY};border-radius:14px;padding:18px 36px;mso-padding-alt:18px 36px;">
                    <span style="font-size:32px;font-weight:800;letter-spacing:0.35em;color:#ffffff;font-family:'Nunito',ui-monospace,Consolas,monospace;mso-font-alt:'Segoe UI';">${safe}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 32px 32px;">
              <p style="margin:0;font-size:13px;font-weight:600;color:${BRAND_PRIMARY};">유효 시간 ${TTL_MINUTES}분</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px;">
              <p style="margin:0;padding-top:20px;border-top:1px solid ${BRAND_BORDER};font-size:12px;line-height:1.6;color:#94a3b8;text-align:center;">본인이 요청하지 않은 경우 이 메일을 무시하셔도 됩니다.<br />Campus Drop · 세종대학교 캠퍼스 매칭 서비스</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { text, html };
}

/**
 * AWS SES (API). EC2 IAM Role 또는 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
 */
async function sendViaSes(to, code) {
  const from = sesFromEmailAddress();
  const region = process.env.AWS_REGION || 'ap-northeast-2';
  if (!from) {
    throw new Error('SES_FROM_EMAIL 환경 변수가 필요합니다.');
  }

  const client = new SESv2Client({ region });
  const { text, html } = buildBodies(code);

  await client.send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: SUBJECT, Charset: 'UTF-8' },
          Body: {
            Text: { Data: text, Charset: 'UTF-8' },
            Html: { Data: html, Charset: 'UTF-8' },
          },
        },
      },
      ...(process.env.SES_CONFIGURATION_SET
        ? { ConfigurationSetName: process.env.SES_CONFIGURATION_SET }
        : {}),
    }),
  );
}

function getSmtpTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    throw new Error('SMTP_HOST, SMTP_USER, SMTP_PASS 환경 변수가 필요합니다.');
  }

  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === 'true';

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

/**
 * 로컬/레거시용 SMTP. `EMAIL_TRANSPORT=smtp` 일 때만 사용.
 */
async function sendViaSmtp(to, code) {
  const transporter = getSmtpTransporter();
  const from =
    process.env.SMTP_FROM || process.env.FROM_EMAIL || process.env.SMTP_USER;
  const { text, html } = buildBodies(code);

  await transporter.sendMail({
    from,
    to,
    subject: SUBJECT,
    text,
    html,
  });
}

function resolveEmailTransport() {
  const mode = (process.env.EMAIL_TRANSPORT || '').toLowerCase().trim();
  if (mode === 'smtp') return 'smtp';
  if (mode === 'ses') return 'ses';
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return 'smtp';
  }
  return 'ses';
}

/**
 * @param {string} to
 * @param {string} code
 */
async function sendVerificationCode(to, code) {
  if (resolveEmailTransport() === 'smtp') {
    return sendViaSmtp(to, code);
  }
  return sendViaSes(to, code);
}

module.exports = { sendVerificationCode };
