/**
 * Teacher reading week calendar: reading_days + OCR daily_records_json fallback.
 * Shared by 学生详情页 and 作业动态阅读卡片（不改变 OCR 解析逻辑，仅复用展示与切换规则）。
 */

/** Local calendar date as YYYY-MM-DD (avoid UTC drift from toISOString). */
export function formatLocalDateYYYYMMDD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Normalize OCR row date to YYYY-MM-DD (fixes lex sort bugs e.g. 2026-3-9 vs 2026-03-15). */
export function normalizeRowDateString(raw) {
  if (raw == null) return "";
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return s.slice(0, 10);
  const y = m[1];
  const mi = parseInt(m[2], 10);
  const di = parseInt(m[3], 10);
  if (Number.isNaN(mi) || Number.isNaN(di)) return s.slice(0, 10);
  const mo = String(mi).padStart(2, "0");
  const d = String(di).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/** Supabase/jsonb may return array, JSON string, or occasionally null. */
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

export function normalizeReadingRecordForCalendar(r) {
  if (!r || typeof r !== "object") return r;
  return {
    ...r,
    daily_records_json: normalizeDailyRecordsJson(r.daily_records_json),
  };
}

export function isReadingDaysEmpty(readingDays) {
  return !Array.isArray(readingDays) || readingDays.length === 0;
}

/** Unique OCR row dates, ascending (chronological). */
export function extractReadingDaysFromDailyRecords(rec) {
  const rows = normalizeDailyRecordsJson(rec?.daily_records_json);
  if (rows.length === 0) return [];
  const days = rows.map((d) => normalizeRowDateString(d?.date)).filter(Boolean);
  const sorted = Array.from(new Set(days)).sort();
  return sorted;
}

/** Persist reading_days from OCR: newest-first, e.g. 2026-03-14, 2026-03-13, … */
export function readingDaysDescendingFromDaily(rec) {
  const asc = extractReadingDaysFromDailyRecords(rec);
  return asc.length ? [...asc].reverse() : [];
}

/**
 * Highlight source: teacher reading_days if non-empty; else dates present in daily_records_json.
 */
export function getCalendarCompletionSource(rec) {
  return !isReadingDaysEmpty(rec.reading_days) ? "reading_days" : "ocr_fallback";
}

export function getEffectiveCompletedDateSet(rec) {
  if (!isReadingDaysEmpty(rec.reading_days)) {
    return new Set(
      rec.reading_days.map((d) => normalizeRowDateString(d)).filter(Boolean)
    );
  }
  return new Set(extractReadingDaysFromDailyRecords(rec));
}

export function isReadingDayCompletedFromRecord(rec, dateStr) {
  const key = normalizeRowDateString(dateStr) || String(dateStr).slice(0, 10);
  return getEffectiveCompletedDateSet(rec).has(key);
}

/** Latest YYYY-MM-DD from OCR daily rows (chronological max). */
export function getLatestOcrDateStr(rec) {
  const asc = extractReadingDaysFromDailyRecords(rec);
  return asc.length ? asc[asc.length - 1] : null;
}

/**
 * Default calendar week: anchored on latest OCR date when daily rows exist.
 * Fallback: reading_days max → created_at → local today.
 */
export function getDefaultWeekAnchorDateStr(rec) {
  const ocrLatest = getLatestOcrDateStr(rec);
  if (ocrLatest) return ocrLatest;
  if (Array.isArray(rec.reading_days) && rec.reading_days.length > 0) {
    const asc = rec.reading_days.map((d) => normalizeRowDateString(d)).filter(Boolean).sort();
    if (asc.length) return asc[asc.length - 1];
  }
  if (rec.created_at) {
    const ca = String(rec.created_at).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ca)) return ca;
  }
  return formatLocalDateYYYYMMDD(new Date());
}

/** Monday 00:00 local of the ISO week (Mon–Sun) that contains baseDateStr. */
export function mondayOfWeekContainingDateStr(baseDateStr) {
  const y = parseInt(String(baseDateStr).slice(0, 4), 10);
  const m = parseInt(String(baseDateStr).slice(5, 7), 10) - 1;
  const d = parseInt(String(baseDateStr).slice(8, 10), 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) {
    const base = new Date(String(baseDateStr) + "T12:00:00");
    const day = base.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(base);
    monday.setDate(base.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }
  const base = new Date(y, m, d);
  const day = base.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(base);
  monday.setDate(base.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function buildWeekDaysFromMonday(monday) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = formatLocalDateYYYYMMDD(d);
    const labelDay = d.getDate();
    const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const weekday = weekdayNames[d.getDay()];
    days.push({ dateStr: iso, labelDay, weekday });
  }
  return days;
}

/** weekOffset: 0 = default (OCR-latest week), ±1 = prev/next week. */
export function getWeekDaysForRecord(rec, weekOffset = 0) {
  const anchor = getDefaultWeekAnchorDateStr(rec);
  const monday0 = mondayOfWeekContainingDateStr(anchor);
  const monday = new Date(monday0);
  monday.setDate(monday0.getDate() + weekOffset * 7);
  return buildWeekDaysFromMonday(monday);
}

/**
 * Same toggle semantics as 教师学生页 handleToggleReadingDay（不立即写库，由调用方在确认后 update）。
 * @returns {{ targetDate: string, updatedDays: string[], currentlyCompleted: boolean } | null}
 */
export function buildToggleReadingDaysUpdate(record, dateStr) {
  const targetDate = normalizeRowDateString(dateStr) || String(dateStr).slice(0, 10);
  if (!targetDate || !record) return null;

  const normalizedRd = Array.isArray(record.reading_days)
    ? record.reading_days.map((d) => normalizeRowDateString(d)).filter(Boolean)
    : [];
  const existingDays =
    normalizedRd.length > 0
      ? [...normalizedRd]
      : [...extractReadingDaysFromDailyRecords(record)];
  const currentlyCompleted = existingDays.includes(targetDate);
  let updatedDays;
  if (currentlyCompleted) {
    updatedDays = existingDays.filter((d) => d !== targetDate);
  } else {
    updatedDays = [...existingDays, targetDate];
  }

  return { targetDate, updatedDays, currentlyCompleted };
}
