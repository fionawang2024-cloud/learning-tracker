/**
 * 整学期评奖统计：依赖「当前未结束学期」起止日期，不受统计页上方范围切换影响。
 * 数据从 students / reading_records / diary_records / speaking_scores 实时汇总。
 */

import { getSupabaseClient } from "./supabaseClient";
import { normalizeReadingDaysArray } from "./readingRecordOcr";
import { normalizeDiaryDaysArray } from "./diaryDate";
import { addDaysYMD, buildYmdSetInclusive, localYMD, localYmdToNoonIsoString, parseYMD, sundayOfWeekContaining } from "./dateRangeUtils";
import {
  buildDailyWordsMapPreferNewestRecord,
  sortReadingRecordsNewestFirst,
  totalWordsFromLatestReadingRecord,
} from "./readingDailyRowHelpers";
import { isSpeakingStrictPresent } from "./speakingStatus";

function readingDaysInSemester(sReads, semSet) {
  const u = new Set();
  for (const row of sReads) {
    normalizeReadingDaysArray(row.reading_days).forEach((d) => {
      if (semSet.has(d)) u.add(d);
    });
  }
  return Array.from(u).sort();
}

/**
 * 连续天数口径：当前学期内，按所有阅读记录合并后的 reading_days（去重、排序），
 * 取其中「最长连续自然日」长度（仅计落在学期区间内的日期）。
 */
export function longestReadingStreakDays(sortedYmds) {
  if (!sortedYmds.length) return 0;
  let best = 1;
  let cur = 1;
  for (let i = 1; i < sortedYmds.length; i++) {
    const prev = parseYMD(sortedYmds[i - 1]);
    prev.setDate(prev.getDate() + 1);
    if (localYMD(prev) === sortedYmds[i]) {
      cur += 1;
      best = Math.max(best, cur);
    } else {
      cur = 1;
    }
  }
  return best;
}

function diaryUniqueDaysInSemester(sDiaries, semSet) {
  const u = new Set();
  for (const row of sDiaries) {
    normalizeDiaryDaysArray(row).forEach((d) => {
      if (semSet.has(d)) u.add(d);
    });
  }
  return u.size;
}

/** 按日去重后的日表，在若干日内 words 之和 */
export function sumDailyWordsInRangeAcrossRecords(sReads, rangeSet) {
  const sorted = sortReadingRecordsNewestFirst(sReads || []);
  const map = buildDailyWordsMapPreferNewestRecord(sorted);
  let sum = 0;
  for (const [d, w] of map) {
    if (rangeSet.has(d)) sum += Number(w) || 0;
  }
  return sum;
}

/**
 * 「日均单词过千周数」列数据源：学期内 daily 按 date 去重（新 reading_record 优先），按「周日～周六」周桶；
 * 仅当该周新单词合计 weekWords > 7000 计 1 合格周（不做日均、不看阅读天数）。
 */
function countQualified7000WeeksSundaySemester(sReads, semStart, semEnd, displayName, studentId) {
  const semSet = buildYmdSetInclusive(semStart, semEnd);
  const sorted = sortReadingRecordsNewestFirst(sReads || []);
  const fullMap = buildDailyWordsMapPreferNewestRecord(sorted);
  const semDaily = new Map();
  for (const [d, w] of fullMap) {
    if (!semSet.has(d)) continue;
    semDaily.set(d, Number(w) || 0);
  }
  const dedupedDates = [...semDaily.keys()].sort();
  if (dedupedDates.length === 0) {
    console.log("[award-stats] student:", displayName);
    console.log("[award-stats] semester range:", `${semStart}~${semEnd}`);
    console.log("[award-stats] week buckets:", []);
    console.log("[award-stats] weekWords:", []);
    console.log("[award-stats] qualified7000Weeks:", 0);
    return 0;
  }

  const byWeekSunday = new Map();
  for (const d of dedupedDates) {
    const sun = sundayOfWeekContaining(d);
    if (!byWeekSunday.has(sun)) {
      byWeekSunday.set(sun, { dates: [], wordsSum: 0 });
    }
    const b = byWeekSunday.get(sun);
    b.dates.push(d);
    b.wordsSum += semDaily.get(d) || 0;
  }

  let qualified7000Weeks = 0;
  const weekBuckets = [];
  for (const [weekSun, b] of [...byWeekSunday.entries()].sort((a, c) => a[0].localeCompare(c[0]))) {
    const weekWords = b.wordsSum;
    const qualifies = weekWords > 7000;
    if (qualifies) qualified7000Weeks += 1;
    weekBuckets.push({
      weekSunday: weekSun,
      weekSaturday: addDaysYMD(weekSun, 6),
      dates: [...b.dates].sort(),
      weekWords,
      qualifies,
    });
  }

  console.log("[award-stats] student:", displayName);
  console.log("[award-stats] semester range:", `${semStart}~${semEnd}`);
  console.log("[award-stats] week buckets:", weekBuckets);
  console.log(
    "[award-stats] weekWords:",
    weekBuckets.map((w) => ({ weekSunday: w.weekSunday, weekSaturday: w.weekSaturday, weekWords: w.weekWords }))
  );
  console.log("[award-stats] qualified7000Weeks:", qualified7000Weeks);

  return qualified7000Weeks;
}

/**
 * 按自然周（周日～周六）列出学期内各周：newWords 与 readingDays 均只计学期内、按日去重后的日表（合格周仍以 newWords>7000 判定）。
 */
export function getWeekWordTotalsByStudent(sReads, semStart, semEnd) {
  const semSet = buildYmdSetInclusive(semStart, semEnd);
  const sorted = sortReadingRecordsNewestFirst(sReads || []);
  const fullMap = buildDailyWordsMapPreferNewestRecord(sorted);
  const semDaily = new Map();
  for (const [d, w] of fullMap) {
    if (!semSet.has(d)) continue;
    semDaily.set(d, Number(w) || 0);
  }

  const firstSun = sundayOfWeekContaining(semStart);
  const lastSun = sundayOfWeekContaining(semEnd);
  const out = [];
  for (let sun = firstSun; sun <= lastSun; sun = addDaysYMD(sun, 7)) {
    const sat = addDaysYMD(sun, 6);
    let newWords = 0;
    const dates = [];
    for (const [d, w] of semDaily) {
      if (d >= sun && d <= sat) {
        newWords += w;
        dates.push(d);
      }
    }
    dates.sort();
    out.push({ weekStart: sun, weekEnd: sat, newWords, readingDays: dates.length });
  }
  return out;
}

/**
 * 口语课出勤率（学期内）：
 * 分母 = 该学生在 [semStart, semEnd] 内 speaking_scores 行数；
 * 分子 = 其中 status = 'present' 的行数；absent_excused 计入分母不计入分子。
 */
function speakingAttendancePercentForStudentRows(rowsInSem) {
  const denom = rowsInSem.length;
  if (denom === 0) return null;
  const num = rowsInSem.filter((r) => isSpeakingStrictPresent(r)).length;
  return Math.round((num / denom) * 1000) / 10;
}

function speakingRowsForStudentInRange(speakingAll, studentId, semStart, semEnd) {
  return (speakingAll || []).filter((row) => {
    if (row.student_id !== studentId) return false;
    const sd = String(row.score_date || "").slice(0, 10);
    return sd && sd >= semStart && sd <= semEnd;
  });
}

/**
 * 拉取「当前学期」行：优先 is_current；无列或未命中时退回 ended_at IS NULL。
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function fetchOpenSemesterRow(supabase) {
  const r1 = await supabase.from("semesters").select("*").eq("is_current", true).maybeSingle();
  if (r1.error) {
    const msg = `${r1.error.message || ""} ${r1.error.details || ""}`;
    const ignorable = msg.includes("is_current") || msg.includes("schema cache");
    if (!ignorable) return r1;
  } else if (r1.data) {
    return { data: r1.data, error: null };
  }
  return supabase
    .from("semesters")
    .select("*")
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

function mapSemesterRowToInfo(data) {
  if (!data) return null;
  const startYmd = localYMD(new Date(data.started_at));
  const endYmd = data.ended_at ? localYMD(new Date(data.ended_at)) : localYMD();
  return {
    id: data.id,
    termLabel: data.term_label || "当前学期",
    startedAt: data.started_at,
    endedAt: data.ended_at || null,
    rangeStartYmd: startYmd,
    rangeEndYmd: endYmd,
    isCurrent: Boolean(data.is_current),
  };
}

/**
 * 按学期时间窗过滤原始行（用于评奖 / 统计 / 导出，避免旧学期数据混入新学期）。
 * reading / diary：created_at ∈ [startedAt, endedAt|now]；speaking：score_date 落在学期 YMD 区间内。
 */
export function filterActivityRowsForSemesterWindow(readings, diaries, speaking, sem) {
  if (!sem?.startedAt) {
    return { readings: readings || [], diaries: diaries || [], speaking: speaking || [] };
  }
  const t0 = new Date(sem.startedAt).getTime();
  const t1 = sem.endedAt ? new Date(sem.endedAt).getTime() : Date.now();
  const y0 = sem.rangeStartYmd;
  const y1 = sem.rangeEndYmd;
  const readingsF = (readings || []).filter((r) => {
    const t = new Date(r.created_at || 0).getTime();
    return t >= t0 && t <= t1;
  });
  const diariesF = (diaries || []).filter((r) => {
    const t = new Date(r.created_at || 0).getTime();
    return t >= t0 && t <= t1;
  });
  const speakingF = (speaking || []).filter((r) => {
    const sd = String(r.score_date || r.class_date || "").slice(0, 10);
    return sd && sd >= y0 && sd <= y1;
  });
  return { readings: readingsF, diaries: diariesF, speaking: speakingF };
}

/**
 * 学期内按「周日～周六」自然周，与 [semStart, semEnd] 有交集的周数 = totalWeeks。
 * 若该周 7 个日历日全部落在学期内，且每日在「阅读日(reading_days) ∪ 日记日」中至少完成其一，则计为完成任务周。
 */
export function countSemesterCompletedTaskWeeksSunday(sReads, sDiaries, semStart, semEnd) {
  const semSet = buildYmdSetInclusive(semStart, semEnd);
  const readingSem = new Set();
  for (const row of sReads || []) {
    normalizeReadingDaysArray(row.reading_days).forEach((d) => {
      if (semSet.has(d)) readingSem.add(d);
    });
  }
  const diarySem = new Set();
  for (const row of sDiaries || []) {
    normalizeDiaryDaysArray(row).forEach((d) => {
      if (semSet.has(d)) diarySem.add(d);
    });
  }

  const firstSun = sundayOfWeekContaining(semStart);
  let totalWeeks = 0;
  let completedWeeks = 0;
  for (let sun = firstSun; sun <= semEnd; sun = addDaysYMD(sun, 7)) {
    const sat = addDaysYMD(sun, 6);
    if (sat < semStart) continue;
    totalWeeks += 1;
    let allSevenInSem = true;
    for (let i = 0; i < 7; i++) {
      const d = addDaysYMD(sun, i);
      if (d < semStart || d > semEnd) {
        allSevenInSem = false;
        break;
      }
    }
    if (!allSevenInSem) continue;
    let full = true;
    for (let i = 0; i < 7; i++) {
      const d = addDaysYMD(sun, i);
      if (!readingSem.has(d) && !diarySem.has(d)) {
        full = false;
        break;
      }
    }
    if (full) completedWeeks += 1;
  }
  return { completedWeeks, totalWeeks };
}

/**
 * 更新当前学期的 started_at（老师自定义学期起始日，本地日历日）。
 * @param {string} startYmd YYYY-MM-DD
 */
export async function updateCurrentSemesterStartYmd(startYmd) {
  const ymd = String(startYmd).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error("学期起始日格式须为 YYYY-MM-DD");
  }
  await ensureCurrentSemester();
  const supabase = getSupabaseClient();
  const { data: row } = await fetchOpenSemesterRow(supabase);
  if (!row?.id) throw new Error("未找到当前学期");
  const iso = localYmdToNoonIsoString(ymd);
  const { error } = await supabase.from("semesters").update({ started_at: iso }).eq("id", row.id);
  if (error) throw error;
  return getCurrentSemesterInfo();
}

export async function getCurrentSemesterInfo() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await fetchOpenSemesterRow(supabase);
    if (error) {
      console.warn("[semester] getCurrentSemesterInfo", error);
      return null;
    }
    return mapSemesterRowToInfo(data);
  } catch (e) {
    console.warn("[semester] getCurrentSemesterInfo", e);
    return null;
  }
}

/** 若无当前学期则插入默认行（需已执行 semesters 建表 SQL） */
export async function ensureCurrentSemester() {
  const supabase = getSupabaseClient();
  const existing = await getCurrentSemesterInfo();
  if (existing) return existing;
  const { data, error } = await supabase
    .from("semesters")
    .insert({
      term_label: `学期 ${localYMD()}`,
      started_at: new Date().toISOString(),
      is_current: true,
      ended_at: null,
    })
    .select("*")
    .single();
  if (error) {
    console.error("[semester] ensureCurrentSemester insert failed", error);
    throw error;
  }
  return mapSemesterRowToInfo(data);
}

/**
 * 纯函数：供客户端与「开始新学期」API 共用，避免归档与页面统计口径不一致。
 */
export function buildSemesterAwardRows(students, readings, diaries, speaking, semStart, semEnd) {
  const semSet = buildYmdSetInclusive(semStart, semEnd);

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

  const out = [];
  for (const s of students || []) {
    const sid = s.id;
    const displayName = s.display_name || s.name || "未命名";
    const sReads = byStudentReadings.get(sid) || [];
    const sDiaries = byStudentDiaries.get(sid) || [];

    const sortedReads = sortReadingRecordsNewestFirst(sReads);
    const sortedReadingDays = readingDaysInSemester(sReads, semSet);
    const consecutiveDays = longestReadingStreakDays(sortedReadingDays);
    const totalWordsSemester = totalWordsFromLatestReadingRecord(sortedReads);
    const diaryTotalCount = diaryUniqueDaysInSemester(sDiaries, semSet);
    const highWordWeeks = countQualified7000WeeksSundaySemester(sReads, semStart, semEnd, displayName, sid);
    const speakingRowsSem = speakingRowsForStudentInRange(speaking, sid, semStart, semEnd);
    const speakingAttendancePct = speakingAttendancePercentForStudentRows(speakingRowsSem);
    const { completedWeeks, totalWeeks } = countSemesterCompletedTaskWeeksSunday(sReads, sDiaries, semStart, semEnd);
    const completedTaskWeeksLabel = `${completedWeeks}/${totalWeeks}`;

    out.push({
      studentId: sid,
      displayName,
      consecutiveDays,
      totalWordsSemester,
      speakingAttendancePct,
      diaryTotalCount,
      highWordWeeks,
      completedTaskWeeksLabel,
    });
  }
  return out;
}

/**
 * @returns {Promise<Array<{
 *   studentId: string,
 *   displayName: string,
 *   consecutiveDays: number,
 *   totalWordsSemester: number,
 *   speakingAttendancePct: number|null,
 *   diaryTotalCount: number,
 *   highWordWeeks: number,
 *   completedTaskWeeksLabel: string
 * }>>}
 */
export async function getCurrentSemesterAwardStats() {
  let sem;
  try {
    sem = await ensureCurrentSemester();
  } catch (e) {
    console.warn("[semesterAward] getCurrentSemesterAwardStats skip (no semesters table?)", e);
    return [];
  }
  const supabase = getSupabaseClient();
  const { data: studentsRaw, error: e1 } = await supabase.from("students").select("*").order("display_name");
  if (e1) {
    console.error("[semesterAward] students", e1);
    return [];
  }
  let students = studentsRaw || [];
  if (sem?.id) {
    students = students.filter((s) => s.semester_id === sem.id);
  }

  const { data: readings } = await supabase
    .from("reading_records")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(12000);
  const { data: diaries } = await supabase.from("diary_records").select("*").order("created_at", { ascending: false }).limit(12000);
  const { data: speaking } = await supabase.from("speaking_scores").select("*").order("created_at", { ascending: false }).limit(12000);

  const semStart = sem.rangeStartYmd;
  const semEnd = sem.rangeEndYmd;

  const { readings: rf, diaries: df, speaking: sf } = filterActivityRowsForSemesterWindow(
    readings || [],
    diaries || [],
    speaking || [],
    sem
  );

  return buildSemesterAwardRows(students || [], rf, df, sf, semStart, semEnd);
}
