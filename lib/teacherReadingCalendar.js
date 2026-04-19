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

/**
 * 仅看 reading_days，不回退 daily_records（用于 OCR 确认弹窗：老师清空后不应再显示 OCR 默认已读）。
 */
export function isReadingDayCompletedStrict(rec, dateStr) {
  const key = normalizeRowDateString(dateStr) || String(dateStr).slice(0, 10);
  if (!key || !rec || !Array.isArray(rec.reading_days)) return false;
  return rec.reading_days
    .map((d) => normalizeRowDateString(d))
    .filter(Boolean)
    .includes(key);
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

/**
 * 包含 baseDateStr 的「自然周」的周日 00:00（本地）。
 * 周视图列顺序：周日 → 周六。
 */
export function sundayOfWeekContainingDateStr(baseDateStr) {
  const y = parseInt(String(baseDateStr).slice(0, 4), 10);
  const m = parseInt(String(baseDateStr).slice(5, 7), 10) - 1;
  const d = parseInt(String(baseDateStr).slice(8, 10), 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) {
    const base = new Date(String(baseDateStr) + "T12:00:00");
    const sun = new Date(base);
    sun.setDate(base.getDate() - base.getDay());
    sun.setHours(0, 0, 0, 0);
    return sun;
  }
  const base = new Date(y, m, d);
  base.setHours(12, 0, 0, 0);
  const sun = new Date(base);
  sun.setDate(base.getDate() - base.getDay());
  sun.setHours(0, 0, 0, 0);
  return sun;
}

/** @deprecated 保留供旧代码引用；新周历请用 sundayOfWeekContainingDateStr */
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

export const WEEKDAY_HEADERS_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function buildWeekDaysFromMonday(monday) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = formatLocalDateYYYYMMDD(d);
    const labelDay = d.getDate();
    const weekday = WEEKDAY_HEADERS_CN[d.getDay()];
    days.push({ dateStr: iso, labelDay, weekday });
  }
  return days;
}

/** 从周日 Date 起连续 7 天（周日 … 周六） */
export function buildWeekDaysFromSunday(sunday) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    const iso = formatLocalDateYYYYMMDD(d);
    const labelDay = d.getDate();
    const weekday = WEEKDAY_HEADERS_CN[d.getDay()];
    days.push({ dateStr: iso, labelDay, weekday });
  }
  return days;
}

/** weekOffset: 0 = default（锚点所在周），±1 = 上一周 / 下一周；列为 周日→周六 */
export function getWeekDaysForRecord(rec, weekOffset = 0) {
  const anchor = getDefaultWeekAnchorDateStr(rec);
  const sunday0 = sundayOfWeekContainingDateStr(anchor);
  const sunday = new Date(sunday0);
  sunday.setDate(sunday0.getDate() + weekOffset * 7);
  return buildWeekDaysFromSunday(sunday);
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
