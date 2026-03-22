-- speaking_scores: 课程日期列名为 score_date（与 student_id 唯一）。
-- 若曾执行过 class_date 版本，会先改名再建索引。

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'speaking_scores' AND column_name = 'class_date'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'speaking_scores' AND column_name = 'score_date'
  ) THEN
    ALTER TABLE speaking_scores RENAME COLUMN class_date TO score_date;
  END IF;
END $$;

DROP INDEX IF EXISTS speaking_scores_student_id_class_date_key;

ALTER TABLE speaking_scores
  ADD COLUMN IF NOT EXISTS score_date date;

DELETE FROM speaking_scores a
USING speaking_scores b
WHERE a.id < b.id
  AND a.student_id = b.student_id
  AND (a.created_at::date) = (b.created_at::date);

UPDATE speaking_scores
SET score_date = COALESCE(score_date, created_at::date)
WHERE score_date IS NULL;

ALTER TABLE speaking_scores
  ALTER COLUMN score_date SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS speaking_scores_student_id_score_date_key
  ON speaking_scores (student_id, score_date);

COMMENT ON COLUMN speaking_scores.score_date IS '口语课上课日期 YYYY-MM-DD；与 student_id 唯一一条分数。';
