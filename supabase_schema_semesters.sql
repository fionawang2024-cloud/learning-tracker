-- 学期归档 + 当前学期（咏梅英文剧社「开始新学期」依赖）
-- 在 Supabase SQL Editor 中执行一次。

CREATE TABLE IF NOT EXISTS public.semesters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term_label text NOT NULL DEFAULT '学期',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  archived_at timestamptz NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.semester_student_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id uuid NOT NULL REFERENCES public.semesters (id) ON DELETE CASCADE,
  student_name text NOT NULL,
  consecutive_days integer NOT NULL DEFAULT 0,
  total_words integer NOT NULL DEFAULT 0,
  speaking_attendance_rate numeric(6, 2) NULL,
  diary_total_count integer NOT NULL DEFAULT 0,
  high_word_weeks integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS semester_student_stats_semester_id_idx ON public.semester_student_stats (semester_id);

COMMENT ON TABLE public.semesters IS '学期区间；ended_at 为空表示当前进行中。';
COMMENT ON TABLE public.semester_student_stats IS '每学期结束时归档的评奖维度快照。';

-- 若尚无学期，插入一条作为「当前学期」
INSERT INTO public.semesters (term_label, started_at, is_current)
SELECT '当前学期', now(), true
WHERE NOT EXISTS (SELECT 1 FROM public.semesters WHERE ended_at IS NULL);

-- 老师端无登录：按需放开 RLS（若表已启用 RLS 请改为合适策略）
ALTER TABLE public.semesters DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.semester_student_stats DISABLE ROW LEVEL SECURITY;
