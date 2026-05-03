-- 나에게 보내기(스케줄 알림 등)용 OAuth 리프레시 토큰. 카카오 로그인 시 동의 범위에 따라 발급될 수 있습니다.
ALTER TABLE "identities" ADD COLUMN IF NOT EXISTS "kakao_refresh_token" TEXT;
