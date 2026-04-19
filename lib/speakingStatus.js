/** 口语课记录状态：与 speaking_scores.status 列一致 */

export const SPEAKING_STATUS_PRESENT = "present";
export const SPEAKING_STATUS_ABSENT_EXCUSED = "absent_excused";

export function isSpeakingExcusedLeave(row) {
  return String(row?.status || "").trim() === SPEAKING_STATUS_ABSENT_EXCUSED;
}

/**
 * 学期出勤率分子：status = 'present'，或旧数据无 status 时视为 present。
 * absent_excused 不计入出勤次数。
 */
export function isSpeakingStrictPresent(row) {
  if (!row) return false;
  if (isSpeakingExcusedLeave(row)) return false;
  const s = String(row.status ?? "").trim();
  return s === "" || s === SPEAKING_STATUS_PRESENT;
}
