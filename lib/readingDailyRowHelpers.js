/**
 * 阅读日表行解析与「按日去重、新记录优先」合并，供完成情况统计与学期评奖共用。
 */

import { normalizeReadingDaysArray, normalizeRowDateString, normalizeDailyRecordsJson } from "./readingRecordOcr";
import { addDaysYMD, localYMD, sundayOfWeekContaining } from "./dateRangeUtils";

/** 将 daily 行上的日期尽量归一成 YYYY-MM-DD，便于与 rangeSet 匹配 */
export function coerceDailyRowDateYMD(row) {
  if (!row || typeof row !== "object") return "";
  const raw = row.date ?? row.Date ?? row.day;
  let ds = normalizeRowDateString(raw);
  if (ds) return ds.slice(0, 10);
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return localYMD(raw);
  const s = String(raw ?? "").trim();
  const slash = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (slash) {
    return `${slash[1]}-${String(slash[2]).padStart(2, "0")}-${String(slash[3]).padStart(2, "0")}`;
  }
  return "";
}

export function parseWordsCell(row) {
  const w = row?.words ?? row?.word ?? row?.new_words;
  if (typeof w === "number" && Number.isFinite(w)) return w;
  const n = parseInt(String(w ?? "").replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** 日表行上的阅读时长（分钟），缺省为 0 */
export function parseTimeMinutesCell(row) {
  const t = row?.time_minutes ?? row?.timeMinutes ?? row?.time_mins;
  if (typeof t === "number" && Number.isFinite(t) && t >= 0) return t;
  const n = parseFloat(String(t ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function dailyRecordsArrayFromReadingRecord(rec) {
  const a = normalizeDailyRecordsJson(rec?.daily_records_json);
  if (a.length) return a;
  return normalizeDailyRecordsJson(rec?.daily_records);
}

/** 按 created_at 新→旧排序（同秒可再按 id 稳定） */
export function sortReadingRecordsNewestFirst(reads) {
  return [...reads].sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    if (tb !== ta) return tb - ta;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}

/**
 * 总阅读单词量：取该学生「最新一条」reading_record 的 total_words（累计快照，不多条相加）。
 */
export function totalWordsFromLatestReadingRecord(sortedNewestFirst) {
  if (!sortedNewestFirst.length) return 0;
  const tw = Number(sortedNewestFirst[0].total_words);
  return Number.isFinite(tw) && tw >= 0 ? tw : 0;
}

/**
 * 合并所有记录的日表：同一自然日只保留一条，优先较新上传记录中的数据（先遍历新记录）。
 * @returns {Map<string, number>} date YYYY-MM-DD -> words
 */
export function buildDailyWordsMapPreferNewestRecord(sortedNewestFirst) {
  const map = new Map();
  for (const rec of sortedNewestFirst) {
    const daily = normalizeDailyRecordsJson(rec.daily_records_json);
    for (const item of daily) {
      const ds = coerceDailyRowDateYMD(item);
      if (!ds) continue;
      if (!map.has(ds)) {
        map.set(ds, parseWordsCell(item));
      }
    }
  }
  return map;
}

/**
 * 合并所有记录的日表：同一自然日只保留一条，优先较新上传记录（先遍历新记录）。
 * @returns {Map<string, number>} date YYYY-MM-DD -> time_minutes
 */
export function buildDailyTimeMinutesMapPreferNewestRecord(sortedNewestFirst) {
  const map = new Map();
  for (const rec of sortedNewestFirst) {
    const daily = dailyRecordsArrayFromReadingRecord(rec);
    for (const item of daily) {
      const ds = coerceDailyRowDateYMD(item);
      if (!ds) continue;
      if (!map.has(ds)) {
        map.set(ds, parseTimeMinutesCell(item));
      }
    }
  }
  return map;
}

/** 对 buildDailyTimeMinutesMapPreferNewestRecord 的结果，只累加 [rangeStart, rangeEnd] 内的分钟 */
export function sumRangeMinutesFromDailyTimeMap(dailyTimeMap, rangeStart, rangeEnd) {
  const rs = String(rangeStart).slice(0, 10);
  const re = String(rangeEnd).slice(0, 10);
  let sum = 0;
  for (const [date, minutes] of dailyTimeMap) {
    if (date >= rs && date <= re) sum += Number(minutes) || 0;
  }
  return sum;
}

/**
 * 仅基于「当前这张」日表：取日表中最晚日期所在自然周（周日～周六），将该周内各行 words 相加。
 * 用于 OCR 确认弹窗「本周新单词」初值；不做跨 reading_record 去重。
 */
export function sumWordsInSundayWeekFromDailyRecordsThisImageOnly(dailyRaw) {
  const daily = normalizeDailyRecordsJson(dailyRaw);
  if (!daily.length) return 0;
  let maxDate = "";
  for (const item of daily) {
    const ds = coerceDailyRowDateYMD(item);
    if (ds && ds > maxDate) maxDate = ds;
  }
  if (!maxDate) return 0;
  const weekSun = sundayOfWeekContaining(maxDate);
  const weekEnd = addDaysYMD(weekSun, 6);
  let sum = 0;
  for (const item of daily) {
    const ds = coerceDailyRowDateYMD(item);
    if (!ds || ds < weekSun || ds > weekEnd) continue;
    sum += parseWordsCell(item);
  }
  return sum;
}

/** 学期或范围内：按 reading_days 与 daily 日表并集统计阅读自然日（去重） */
export function readingDaysUnionInSet(sReads, daySet) {
  const u = new Set();
  for (const row of sReads || []) {
    normalizeReadingDaysArray(row.reading_days).forEach((d) => {
      if (daySet.has(d)) u.add(d);
    });
  }
  const sorted = sortReadingRecordsNewestFirst(sReads || []);
  const dailyMap = buildDailyWordsMapPreferNewestRecord(sorted);
  for (const d of dailyMap.keys()) {
    if (daySet.has(d)) u.add(d);
  }
  return u;
}
