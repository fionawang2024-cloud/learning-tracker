/**
 * diary_days：教师标注的完成日列表（jsonb）；统计不以上传日为准。
 * 若 diary_days 为空，仅回退 legacy diary_date（单天），不回退 upload_date。
 */

import {
  mondayOfWeekContainingDateStr,
  buildWeekDaysFromMonday,
  formatLocalDateYYYYMMDD,
} from "@/lib/teacherReadingCalendar";

export function normalizeDiaryDateYMD(v) {
  if (v == null || v === "") return "";
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function parseDiaryDaysRaw(raw) {
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
 * 升序唯一 YYYY-MM-DD。优先 diary_days；若为空则用旧列 diary_date 单日（迁移兼容）。
 */
export function normalizeDiaryDaysArray(record) {
  if (!record || typeof record !== "object") return [];
  const list = parseDiaryDaysRaw(record.diary_days);
  const set = new Set();
  for (const x of list) {
    const n = normalizeDiaryDateYMD(x);
    if (n) set.add(n);
  }
  if (set.size === 0) {
    const leg = normalizeDiaryDateYMD(record.diary_date);
    if (leg) set.add(leg);
  }
  return Array.from(set).sort();
}

/** 展示用：「2026-03-10、2026-03-11」或 — */
export function formatDiaryDaysDisplay(record) {
  const days = normalizeDiaryDaysArray(record);
  if (days.length === 0) return "—";
  return days.join("、");
}

/**
 * 周历「默认周 / 识别周」锚点：仅用上传日、创建日、旧 diary_date、今天。
 * 不使用 diary_days，避免教师多选日期后周视图随选中日期跳转。
 */
export function getDiaryWeekAnchorYMD(record) {
  const up = normalizeDiaryDateYMD(record?.upload_date);
  if (up) return up;
  if (record?.created_at) {
    const ca = String(record.created_at).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ca)) return ca;
  }
  const leg = normalizeDiaryDateYMD(record?.diary_date);
  if (leg) return leg;
  return formatLocalDateYYYYMMDD(new Date());
}

export function getDiaryWeekDaysForRecord(record, weekOffset = 0) {
  const anchor = getDiaryWeekAnchorYMD(record);
  const monday0 = mondayOfWeekContainingDateStr(anchor);
  const monday = new Date(monday0);
  monday.setDate(monday0.getDate() + weekOffset * 7);
  return buildWeekDaysFromMonday(monday);
}

/** 某完成日是否在记录中（用于按日筛选） */
export function diaryRecordHasDate(record, dateYMD) {
  const key = normalizeDiaryDateYMD(dateYMD);
  if (!key) return false;
  return normalizeDiaryDaysArray(record).includes(key);
}

/** 与 [start,end] 是否有交集（作业动态筛选） */
export function diaryDaysIntersectRange(record, startStr, endStr) {
  return normalizeDiaryDaysArray(record).some((d) => d >= startStr && d <= endStr);
}
