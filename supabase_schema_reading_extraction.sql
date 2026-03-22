-- Optional schema changes for reading OCR (run in Supabase SQL editor if needed).
-- reading_records: add extraction_status and total_reading_days.

ALTER TABLE reading_records
  ADD COLUMN IF NOT EXISTS extraction_status text DEFAULT 'failed';

ALTER TABLE reading_records
  ADD COLUMN IF NOT EXISTS total_reading_days integer;

-- New: cumulative books count if available from OCR (累计本数)
ALTER TABLE reading_records
  ADD COLUMN IF NOT EXISTS total_books integer;

-- New: structured per-day rows parsed from the daily table in the screenshot
ALTER TABLE reading_records
  ADD COLUMN IF NOT EXISTS daily_records_json jsonb;

-- Default empty array when column exists (avoids null vs [] confusion)
ALTER TABLE reading_records
  ALTER COLUMN daily_records_json SET DEFAULT '[]'::jsonb;

UPDATE reading_records
SET daily_records_json = '[]'::jsonb
WHERE daily_records_json IS NULL;

-- New: teacher-corrected reading completion days (array of dates: ['2026-03-11','2026-03-12',...])
ALTER TABLE reading_records
  ADD COLUMN IF NOT EXISTS reading_days jsonb;

COMMENT ON COLUMN reading_records.extraction_status IS 'success | needs_review | failed';
COMMENT ON COLUMN reading_records.total_reading_days IS 'Optional, from OCR if available';
COMMENT ON COLUMN reading_records.total_books IS 'Optional, cumulative books from OCR if available';
COMMENT ON COLUMN reading_records.daily_records_json IS 'Array of { date, words, time_minutes, books? } parsed from the screenshot';
COMMENT ON COLUMN reading_records.reading_days IS 'Array of YYYY-MM-DD dates (strings) corrected/confirmed by teacher';
