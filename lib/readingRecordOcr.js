/**
 * Shared helpers for OCR-derived reading record fields (student save + API + teacher).
 *
 * Data flow (reading completion outside OCR):
 * - OCR module writes parsed dates into reading_records.reading_days (and daily_records_json).
 * - Student history calendar & teacher weekly report read only reading_days (not raw OCR text).
 * - Teacher manual edits to reading_days in DB override OCR for all UIs that use this field.
 */

/** Normalize a row date to YYYY-MM-DD for stable sort/storage. */
export function normalizeRowDateString(raw) {
  if (raw == null) return "";
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return s.slice(0, 10);
  const y = m[1];
  const mi = parseInt(m[2], 10);
  const di = parseInt(m[3], 10);
  if (Number.isNaN(mi) || Number.isNaN(di)) return s.slice(0, 10);
  return `${y}-${String(mi).padStart(2, "0")}-${String(di).padStart(2, "0")}`;
}

/** Unique dates from daily rows, ascending. */
export function datesAscendingFromDailyJson(daily) {
  if (!Array.isArray(daily) || daily.length === 0) return [];
  const days = daily.map((d) => normalizeRowDateString(d?.date)).filter(Boolean);
  return Array.from(new Set(days)).sort();
}

/**
 * reading_days for DB: newest-first (e.g. 2026-03-15, 2026-03-14, …).
 * Returns null if no valid dates.
 */
export function deriveReadingDaysDescending(daily) {
  const asc = datesAscendingFromDailyJson(daily);
  return asc.length ? [...asc].reverse() : null;
}

/** Supabase/jsonb may return array or JSON string. */
export function normalizeDailyRecordsJson(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Normalized sorted unique YYYY-MM-DD list from reading_records.reading_days (jsonb array).
 * Source of truth for reading completion outside the OCR module.
 */
export function normalizeReadingDaysArray(raw) {
  if (!Array.isArray(raw)) return [];
  const out = raw.map((d) => normalizeRowDateString(d)).filter(Boolean);
  return Array.from(new Set(out)).sort();
}
