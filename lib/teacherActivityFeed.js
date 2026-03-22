/**
 * Teacher dashboard: merge reading_records + diary_records into one activity feed.
 */

import { getPublicUrl } from "@/lib/storage";
import { recordEffectiveDate, computeWeeklyNewWordsFromReadings } from "@/lib/weeklyReadingWords";
import { normalizeDiaryDaysArray, diaryDaysIntersectRange } from "@/lib/diaryDate";

export function localYMD(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday .. Sunday (local) containing ymd string YYYY-MM-DD */
export function mondaySundayBoundsForYMD(ymd) {
  if (!ymd || ymd.length < 10) return null;
  const y = parseInt(ymd.slice(0, 4), 10);
  const mo = parseInt(ymd.slice(5, 7), 10) - 1;
  const d = parseInt(ymd.slice(8, 10), 10);
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) return null;
  const base = new Date(y, mo, d);
  const day = base.getDay();
  const monOff = day === 0 ? -6 : 1 - day;
  const mon = new Date(base);
  mon.setDate(base.getDate() + monOff);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { start: localYMD(mon), end: localYMD(sun) };
}

function studentDisplayName(s) {
  if (!s) return "未知学生";
  return (s.display_name || "").trim() || (s.email || "").split("@")[0] || s.email || "未知学生";
}

function readingSortTime(r) {
  const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
  if (!Number.isNaN(t)) return t;
  const u = r.upload_date ? new Date(r.upload_date + "T12:00:00").getTime() : 0;
  return u;
}

function diarySortTime(d) {
  const t = d.created_at ? new Date(d.created_at).getTime() : NaN;
  if (!Number.isNaN(t)) return t;
  return d.upload_date ? new Date(d.upload_date + "T12:00:00").getTime() : 0;
}

/**
 * @param {Array} allReadings - all reading_records rows
 * @param {Array} allDiaries - all diary_records rows
 * @param {Array} students - students list for names
 * @returns {Array<FeedItem>} newest first
 */
export function buildActivityFeedItems(allReadings, allDiaries, students) {
  const byId = Object.fromEntries((students || []).map((s) => [s.id, s]));

  const readingsByStudent = {};
  for (const r of allReadings || []) {
    const sid = r.student_id;
    if (!readingsByStudent[sid]) readingsByStudent[sid] = [];
    readingsByStudent[sid].push(r);
  }

  const readingItems = (allReadings || []).map((r) => {
    const st = byId[r.student_id];
    const eff = recordEffectiveDate(r) || (r.created_at ? String(r.created_at).slice(0, 10) : null) || r.upload_date;
    const bounds = eff ? mondaySundayBoundsForYMD(eff) : null;
    const studentReadings = readingsByStudent[r.student_id] || [];
    let weeklyNew = null;
    if (bounds) {
      weeklyNew = computeWeeklyNewWordsFromReadings(studentReadings, bounds.start, bounds.end, {
        log: false,
      });
    }
    const path = r.image_path;
    const imageUrl = path ? getPublicUrl("reading-images", path) : "";

    return {
      type: "reading",
      id: r.id,
      student_id: r.student_id,
      student_name: studentDisplayName(st),
      created_at: r.created_at || (r.upload_date ? `${r.upload_date}T12:00:00` : ""),
      sortTime: readingSortTime(r),
      image_url: imageUrl,
      total_words: r.total_words,
      weekly_new_words: weeklyNew,
      extraction_status: r.extraction_status || "needs_review",
      diary_graded: null,
    };
  });

  const diaryItems = (allDiaries || []).map((d) => {
    const st = byId[d.student_id];
    const path = d.image_path;
    const imageUrl = path ? getPublicUrl("diary-images", path) : "";
    const feedback = (d.teacher_feedback || "").trim();
    const diaryDaysForFilter = normalizeDiaryDaysArray(d);
    const diaryDaysDisplay = diaryDaysForFilter.length ? diaryDaysForFilter.join("、") : "";
    return {
      type: "diary",
      id: d.id,
      student_id: d.student_id,
      student_name: studentDisplayName(st),
      created_at: d.created_at || (d.upload_date ? `${d.upload_date}T12:00:00` : ""),
      sortTime: diarySortTime(d),
      image_url: imageUrl,
      total_words: null,
      weekly_new_words: null,
      extraction_status: null,
      diary_graded: feedback.length > 0,
      teacher_feedback_preview: feedback.slice(0, 80),
      diary_days: d.diary_days ?? [],
      diary_date: d.diary_date ?? null,
      diaryDaysForFilter,
      diaryDaysDisplay,
    };
  });

  const merged = [...readingItems, ...diaryItems];
  merged.sort((a, b) => b.sortTime - a.sortTime);
  return merged;
}

/**
 * @param {string} rangePreset - 'all' | 'today' | 'week' | 'month' | 'custom'
 */
export function getFeedDateRange(preset, customStart, customEnd) {
  if (preset === "all") return { start: null, end: null };
  const today = localYMD(new Date());
  if (preset === "today") return { start: today, end: today };
  if (preset === "week") {
    const mon = mondaySundayBoundsForYMD(today);
    return mon ? { start: mon.start, end: mon.end } : { start: today, end: today };
  }
  if (preset === "month") {
    const d = new Date();
    const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    return { start, end: today };
  }
  if (preset === "custom" && customStart && customEnd) {
    return {
      start: customStart.slice(0, 10),
      end: customEnd.slice(0, 10),
    };
  }
  return { start: null, end: null };
}

function itemDateKey(item) {
  const ca = item.created_at;
  if (!ca) return "";
  return String(ca).slice(0, 10);
}

/**
 * @param {string} typeFilter - 'all' | 'reading' | 'diary'
 * @param {string} statusFilter - 'all' | 'diary_ungraded' | 'diary_graded' | 'reading_needs_review'
 */
export function filterActivityFeedItems(items, filters) {
  const {
    nameQuery = "",
    rangePreset = "all",
    customStart = "",
    customEnd = "",
    typeFilter = "all",
    statusFilter = "all",
  } = filters;

  const { start, end } = getFeedDateRange(rangePreset, customStart, customEnd);
  const q = nameQuery.trim().toLowerCase();

  return items.filter((it) => {
    if (q && !it.student_name.toLowerCase().includes(q)) return false;

    if (start && end) {
      if (it.type === "diary") {
        if (!diaryDaysIntersectRange(it, start, end)) {
          return false;
        }
      } else {
        const key = itemDateKey(it);
        if (!key || key < start || key > end) return false;
      }
    }

    if (typeFilter === "reading" && it.type !== "reading") return false;
    if (typeFilter === "diary" && it.type !== "diary") return false;

    if (statusFilter === "diary_ungraded") {
      if (it.type !== "diary" || it.diary_graded) return false;
    } else if (statusFilter === "diary_graded") {
      if (it.type !== "diary" || !it.diary_graded) return false;
    } else if (statusFilter === "reading_needs_review") {
      if (it.type !== "reading") return false;
      const st = it.extraction_status || "";
      if (st !== "needs_review" && st !== "failed") return false;
    }

    return true;
  });
}
