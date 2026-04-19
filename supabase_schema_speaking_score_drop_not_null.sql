-- 请假时 score 必须为 NULL：若 score 仍为 NOT NULL，口语 upsert 会失败。
-- 在 Supabase SQL Editor 执行一次（可重复执行）。

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'speaking_scores'
      AND column_name = 'score'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.speaking_scores ALTER COLUMN score DROP NOT NULL;
  END IF;
END $$;
