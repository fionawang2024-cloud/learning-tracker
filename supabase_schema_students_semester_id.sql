-- 学生名册按学期隔离：老师端只展示 semester_id = 当前学期的学生；开始新学期后不删旧行，旧学生仍带旧 semester_id。

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS semester_id uuid REFERENCES semesters (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_semester_id ON students (semester_id);

COMMENT ON COLUMN students.semester_id IS '所属学期名册；与当前学期 id 一致才在老师列表中显示；NULL 为迁移前遗留';

-- 一次性回填：将尚无 semester_id 的学生挂到「当前」学期（若存在），避免上线后老数据全部消失；新学期开始后仅新插入学生会绑定新 id。
UPDATE students s
SET semester_id = sub.id
FROM (
  SELECT id
  FROM semesters
  WHERE is_current = true
  ORDER BY started_at DESC
  LIMIT 1
) sub
WHERE s.semester_id IS NULL;
