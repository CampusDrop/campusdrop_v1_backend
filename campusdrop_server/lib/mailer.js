const nodemailer = require('nodemailer');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const SUBJECT = '[Campus Drop] 이메일 인증 번호';

function buildBodies(code) {
  return {
    text: `인증 번호: ${code}\n\n유효 시간은 3분입니다.`,
    html: `<p>인증 번호: <strong>${code}</strong></p><p>유효 시간은 3분입니다.</p>`,
  };
}

/**
 * AWS SES (API). EC2 IAM Role 또는 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
 */
async function sendViaSes(to, code) {
  const from = process.env.SES_FROM_EMAIL;
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
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const { text, html } = buildBodies(code);

  await transporter.sendMail({
    from,
    to,
    subject: SUBJECT,
    text,
    html,
  });
}

/**
 * @param {string} to
 * @param {string} code
 */
async function sendVerificationCode(to, code) {
  const mode = (process.env.EMAIL_TRANSPORT || 'ses').toLowerCase();
  if (mode === 'smtp') {
    return sendViaSmtp(to, code);
  }
  return sendViaSes(to, code);
}

module.exports = { sendVerificationCode };
