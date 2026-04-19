-- 口语课 status + score 可空（请假）。在 Supabase SQL Editor 中执行一次。

-- 1) 先允许 score 为空，避免后续写入请假时报 NOT NULL
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

ALTER TABLE public.speaking_scores
  ADD COLUMN IF NOT EXISTS status text;

UPDATE public.speaking_scores
SET status = 'present'
WHERE status IS NULL OR trim(status) = '';

ALTER TABLE public.speaking_scores
  ALTER COLUMN status SET DEFAULT 'present';

COMMENT ON COLUMN public.speaking_scores.status IS 'present=出勤记分；absent_excused=请假（score 可为空）';
