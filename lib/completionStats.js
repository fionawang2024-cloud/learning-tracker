/**
 * 完成情况统计：按任意日期范围聚合 students / reading_records / diary_records / speaking_scores
 *
 * 总阅读小时（展示列）：该学生按 created_at 最新一条 reading_record 的 total_time_minutes（OCR 累计总时长），格式化为 X小时Y分。
 *
 * 范围内日表阅读小时（rangeReadingHours）：用于导出等场景；从日表按日去重后仅统计 [rangeStart, rangeEnd] 内 time_minutes 之和÷60。
 *
 * 总阅读单词量：该学生按 created_at 最新一条 reading_record 的 total_words（累计快照，不多条相加）。
 *
 * 范围新单词：所有 reading_record 的 daily_records 按「日」去重（同日保留较新记录中的 words）后，
 * 仅对 date ∈ [rangeStart, rangeEnd] 的 words 求和。
 */

import { getSupabaseClient } from "./supabaseClient";
import { normalizeReadingDaysArray } from "./readingRecordOcr";
import { normalizeDiaryDaysArray } from "./diaryDate";
import { buildYmdSetInclusive, countCalendarDaysInclusive, localYMD, rolling7DaysLocal } from "./dateRangeUtils";
import { filterActivityRowsForSemesterWindow, getCurrentSemesterInfo } from "./semesterAwardStats";
import { stableEncouragementForStudentId } from "./stableEncouragement";
import {
  buildDailyTimeMinutesMapPreferNewestRecord,
  buildDailyWordsMapPreferNewestRecord,
  sortReadingRecordsNewestFirst,
  sumRangeMinutesFromDailyTimeMap,
  totalWordsFromLatestReadingRecord,
} from "./readingDailyRowHelpers";
import { isSpeakingExcusedLeave } from "./speakingStatus";

export { buildYmdSetInclusive, countCalendarDaysInclusive, localYMD, rolling7DaysLocal } from "./dateRangeUtils";

function speakingRowYmd(row) {
  if (!row) return "";
  if (row.score_date) return String(row.score_date).slice(0, 10);
  if (row.class_date) return String(row.class_date).slice(0, 10);
  return "";
}

function readingDaysSetInRange(readingRows, rangeSet) {
  const union = new Set();
  for (const row of readingRows) {
    normalizeReadingDaysArray(row.reading_days).forEach((d) => {
      if (rangeSet.has(d)) union.add(d);
    });
  }
  return union;
}

function diaryDaysSetInRange(diaryRows, rangeSet) {
  const set = new Set();
  for (const row of diaryRows) {
    normalizeDiaryDaysArray(row).forEach((d) => {
      if (rangeSet.has(d)) set.add(d);
    });
  }
  return set;
}

/** 仅统计 [rangeStart, rangeEnd] 内各日 words 之和（日期已去重） */
function sumRangeWordsFromDailyMap(dailyWordMap, rangeStart, rangeEnd) {
  let sum = 0;
  for (const [date, words] of dailyWordMap) {
    if (date >= rangeStart && date <= rangeEnd) {
      sum += Number(words) || 0;
    }
  }
  return sum;
}

function hasDailyTimeKeyInRange(dailyTimeMap, rangeStart, rangeEnd) {
  const rs = String(rangeStart).slice(0, 10);
  const re = String(rangeEnd).slice(0, 10);
  for (const d of dailyTimeMap.keys()) {
    if (d >= rs && d <= re) return true;
  }
  return false;
}

export function formatWeekCompletionDetail(totalDays, diaryDays, readingDays) {
  return `完成${totalDays}天，日记${diaryDays}天，阅读${readingDays}天`;
}

/**
 * 纯函数：在已过滤好的表数据上，按 [rangeStart, rangeEnd] 聚合一行/学生（与统计页表格一致）。
 * cumulativeTotalTimeMinutes：最新一条 reading_record.total_time_minutes（无记录或非有限数为 null）。
 * rangeReadingHours：范围内日表阅读小时（无范围内日表键时为 null）。
 */
export function computeRangeStatsFromTables(students, readings, diaries, speaking, rangeStart, rangeEnd) {
  const start = String(rangeStart).slice(0, 10);
  const end = String(rangeEnd).slice(0, 10);
  const rangeSet = buildYmdSetInclusive(start, end);
  const rangeDayCount = Math.max(1, countCalendarDaysInclusive(start, end));

  const byStudentReadings = new Map();
  for (const row of readings || []) {
    const id = row.student_id;
    if (!id) continue;
    if (!byStudentReadings.has(id)) byStudentReadings.set(id, []);
    byStudentReadings.get(id).push(row);
  }

  const byStudentDiaries = new Map();
  for (const row of diaries || []) {
    const id = row.student_id;
    if (!id) continue;
    if (!byStudentDiaries.has(id)) byStudentDiaries.set(id, []);
    byStudentDiaries.get(id).push(row);
  }

  const speakingInRangeByStudent = new Map();
  for (const row of speaking || []) {
    const sd = speakingRowYmd(row);
    if (!sd || sd < start || sd > end) continue;
    const id = row.student_id;
    if (!id) continue;
    const prev = speakingInRangeByStudent.get(id);
    if (!prev || sd > String(prev.score_date || "").slice(0, 10)) {
      speakingInRangeByStudent.set(id, row);
    }
  }

  const out = [];
  for (const s of students || []) {
    const sid = s.id;
    const displayName = s.display_name || s.name || "未命名";

    const sReads = byStudentReadings.get(sid) || [];
    const sortedReads = sortReadingRecordsNewestFirst(sReads);
    const latest = sortedReads[0] || null;
    const rawCumulativeTm = latest != null ? Number(latest.total_time_minutes) : NaN;
    const cumulativeTotalTimeMinutes =
      latest != null && Number.isFinite(rawCumulativeTm) && rawCumulativeTm >= 0 ? Math.round(rawCumulativeTm) : null;

    const dailyTimeMap = buildDailyTimeMinutesMapPreferNewestRecord(sortedReads);
    const rangeMinutes = sumRangeMinutesFromDailyTimeMap(dailyTimeMap, start, end);
    const hasDailyInRange = hasDailyTimeKeyInRange(dailyTimeMap, start, end);
    const rangeHoursRaw = rangeMinutes / 60;
    const rangeReadingHours = hasDailyInRange ? Math.round(rangeHoursRaw * 10) / 10 : null;

    const totalReadingWords = totalWordsFromLatestReadingRecord(sortedReads);
    const dailyWordMap = buildDailyWordsMapPreferNewestRecord(sortedReads);
    const rangeNewWords = sumRangeWordsFromDailyMap(dailyWordMap, start, end);

    const sDiaries = byStudentDiaries.get(sid) || [];
    const readingSet = readingDaysSetInRange(sReads, rangeSet);
    const diarySet = diaryDaysSetInRange(sDiaries, rangeSet);
    const readingDays = readingSet.size;
    const diaryDays = diarySet.size;
    const totalDays = new Set([...readingSet, ...diarySet]).size;
    const baseCompletion = formatWeekCompletionDetail(totalDays, diaryDays, readingDays);
    const enc = stableEncouragementForStudentId(sid);
    const rangeCompletionLabel = `${baseCompletion}，${enc}`;

    console.log("[rangeStats:reading]", {
      studentId: sid,
      displayName,
      rangeStart: start,
      rangeEnd: end,
      latestTotalWords: totalReadingWords,
      dailyWordMap: Object.fromEntries(dailyWordMap),
      rangeWords: rangeNewWords,
      cumulativeTotalTimeMinutes,
      rangeReadingHours,
    });
    console.log("[rangeStats:daily-reading-hours]", {
      displayName,
      dedupedDailyTimeMap: Object.fromEntries(dailyTimeMap),
      rangeStart: start,
      rangeEnd: end,
      rangeMinutes,
      rangeHours: rangeHoursRaw,
    });

    const sp = speakingInRangeByStudent.get(sid);
    let speakingLabel = "";
    if (sp) {
      if (isSpeakingExcusedLeave(sp)) speakingLabel = "请假";
      else {
        const st = String(sp.status ?? "").trim();
        const legacyPresent = st === "" || st === "present";
        if (legacyPresent && sp.score != null && String(sp.score).trim() !== "") {
          const n = Number(sp.score);
          if (Number.isFinite(n)) speakingLabel = String(n);
        }
      }
    }

    const rangeDiaryLabel = diaryDays > 0 ? `${diaryDays}/${rangeDayCount}` : "";

    out.push({
      studentId: sid,
      displayName,
      cumulativeTotalTimeMinutes,
      rangeReadingHours,
      totalReadingWords,
      rangeNewWords,
      rangeDiaryLabel,
      speakingLabel,
      rangeCompletionLabel,
      totalCompletedDays: totalDays,
    });
  }

  return out;
}

/**
 * @param {string} rangeStart YYYY-MM-DD
 * @param {string} rangeEnd YYYY-MM-DD
 */
export async function getRangeStats(rangeStart, rangeEnd) {
  const supabase = getSupabaseClient();

  const { data: studentsRaw, error: e1 } = await supabase.from("students").select("*").order("display_name");
  if (e1) {
    console.error("[completionStats] students", e1);
    return [];
  }
  let students = studentsRaw || [];
  try {
    const sem = await getCurrentSemesterInfo();
    if (sem?.id) {
      students = students.filter((s) => s.semester_id === sem.id);
    }
  } catch {
    /* ignore */
  }

  const { data: readings, error: e2 } = await supabase
    .from("reading_records")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(12000);
  if (e2) console.error("[completionStats] reading_records", e2);

  const { data: diaries, error: e3 } = await supabase
    .from("diary_records")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(12000);
  if (e3) console.error("[completionStats] diary_records", e3);

  const { data: speaking, error: e4 } = await supabase
    .from("speaking_scores")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(12000);
  if (e4) console.error("[completionStats] speaking_scores", e4);

  let r = readings || [];
  let d = diaries || [];
  let sp = speaking || [];
  try {
    const sem = await getCurrentSemesterInfo();
    if (sem) {
      const f = filterActivityRowsForSemesterWindow(r, d, sp, sem);
      r = f.readings;
      d = f.diaries;
      sp = f.speaking;
    }
  } catch (e) {
    console.warn("[completionStats] semester filter skipped", e);
  }

  return computeRangeStatsFromTables(students, r, d, sp, rangeStart, rangeEnd);
}

/** @deprecated 兼容旧名：近 7 个自然日（含今天），非 ISO 周 */
export async function getCompletionStats() {
  const range7 = rolling7DaysLocal();
  const start = range7[0];
  const end = range7[range7.length - 1];
  const rows = await getRangeStats(start, end);
  return rows.map((r) => ({
    studentId: r.studentId,
    displayName: r.displayName,
    cumulativeTotalTimeMinutes: r.cumulativeTotalTimeMinutes,
    rangeReadingHours: r.rangeReadingHours,
    totalReadingWords: r.totalReadingWords,
    weekNewWords: r.rangeNewWords,
    weekDiaryLabel: r.rangeDiaryLabel,
    speakingLabel: r.speakingLabel,
    weekCompletionLabel: r.rangeCompletionLabel,
  }));
}
