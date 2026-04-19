/** 统计页：无数据或 0 时统一显示全角破折号 */

import { formatMinutesToHourMinute } from "./timeFormat";

export const STAT_EMPTY = "——";

/**
 * @param {unknown} value — 数字或可转数字
 * @returns {string}
 */
export function formatStatNumber(value) {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n) || n === 0) return STAT_EMPTY;
  return String(n);
}

/** 与 formatStatNumber 相同，便于语义上统称「统计数值」 */
export const formatStatValue = formatStatNumber;

/**
 * @param {number|null|undefined} pct — 已四舍五入到 0.1 的百分数，如 80 表示 80%
 */
export function formatStatPercent(pct) {
  if (pct == null || !Number.isFinite(pct) || pct === 0) return STAT_EMPTY;
  return `${pct}%`;
}

/** 范围内日表阅读小时（小数小时）；无数据（null/undefined）为 —— */
export function formatStatHours(hours) {
  if (hours == null) return STAT_EMPTY;
  const n = typeof hours === "number" ? hours : parseFloat(String(hours));
  if (!Number.isFinite(n)) return STAT_EMPTY;
  const rounded = Math.round(n * 10) / 10;
  if (rounded === 0) return "0.0 小时";
  return `${rounded} 小时`;
}

/** 最新一条 reading_record 的累计总分钟 →「315小时53分」；无有效数据为 —— */
export function formatStatCumulativeReadingMinutes(totalMinutes) {
  if (totalMinutes == null || totalMinutes === "") return STAT_EMPTY;
  const m = Math.round(Number(totalMinutes));
  if (!Number.isFinite(m) || m < 0) return STAT_EMPTY;
  if (m === 0) return "0分";
  const s = formatMinutesToHourMinute(m);
  return s === "—" ? STAT_EMPTY : s;
}

/** 范围日记列：无日记天为 —— */
export function formatStatDiaryLabel(label) {
  if (label == null || String(label).trim() === "") return STAT_EMPTY;
  return String(label);
}

/** 口语列：分数、请假、或 —— */
export function formatStatSpeakingLabel(label) {
  if (label == null) return STAT_EMPTY;
  const s = String(label).trim();
  if (s === "" || s === "暂无") return STAT_EMPTY;
  return s;
}
