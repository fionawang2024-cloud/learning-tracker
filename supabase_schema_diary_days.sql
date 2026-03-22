-- diary_records: 多篇日记可对应多完成日（教师标注）。
ALTER TABLE diary_records
  ADD COLUMN IF NOT EXISTS diary_days jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 将旧 diary_date 迁入 diary_days（单元素数组）
UPDATE diary_records
SET diary_days = jsonb_build_array(diary_date::text)
WHERE diary_date IS NOT NULL
  AND (diary_days IS NULL OR diary_days = '[]'::jsonb OR jsonb_array_length(diary_days) = 0);

COMMENT ON COLUMN diary_records.diary_days IS '日记完成日列表 YYYY-MM-DD（jsonb 数组）；统计与日历以此为准，不以上传日为准。';
