-- 当前学期标记 is_current + created_at（与「学期起始日」「开始新学期」联动）
-- 已有 semesters 表时执行一次。

ALTER TABLE public.semesters
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false;

ALTER TABLE public.semesters
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- 未结束的学期标为当前
UPDATE public.semesters
SET is_current = true
WHERE ended_at IS NULL;

UPDATE public.semesters
SET is_current = false
WHERE ended_at IS NOT NULL;

COMMENT ON COLUMN public.semesters.is_current IS 'true=当前工作学期；结束新学期时置 false';
