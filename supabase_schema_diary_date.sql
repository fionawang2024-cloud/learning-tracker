-- diary_records: teacher-assigned completion date (single day per row).
-- Run in Supabase SQL editor if the column does not exist yet.

-- 已由 diary_days（jsonb 数组）替代统计口径；请使用 supabase_schema_diary_days.sql。
-- 若本列仍存在，仅作迁移前旧数据；应用层 normalizeDiaryDaysArray 可在 diary_days 为空时读一次 diary_date。

ALTER TABLE diary_records
  ADD COLUMN IF NOT EXISTS diary_date date;

COMMENT ON COLUMN diary_records.diary_date IS '（旧）单日完成日；请以 diary_days 为准。';
