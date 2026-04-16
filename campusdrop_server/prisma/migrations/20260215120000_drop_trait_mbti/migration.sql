-- DropTraitMbti (빈 DB에는 traits 테이블이 없을 수 있음)
ALTER TABLE IF EXISTS "traits" DROP COLUMN IF EXISTS "mbti";
