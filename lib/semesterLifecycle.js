/**
 * 「开始新学期」服务端逻辑：归档评奖行、结束当前学期、创建新学期；不删除 students / 阅读 / 日记 / 口语等业务表。
 * 由 API Route 注入已配置好的 Supabase client（推荐 service_role）。
 */

import { buildSemesterAwardRows, fetchOpenSemesterRow, filterActivityRowsForSemesterWindow } from "./semesterAwardStats";
import { localYMD, localYmdToNoonIsoString } from "./dateRangeUtils";

function finiteNumberOrZero(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function finiteIntOrZero(n) {
  return Math.round(finiteNumberOrZero(n));
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ nextTermLabel?: string, nextStartedAtYmd?: string }} opts
 */
export async function runStartNewSemester(supabase, opts = {}) {
  const { nextTermLabel, nextStartedAtYmd } = opts;

  const { data: openSem, error: e0 } = await fetchOpenSemesterRow(supabase);
  if (e0) throw e0;
  if (!openSem?.id) {
    throw new Error("未找到当前学期：请先在 Supabase 执行 supabase_schema_semesters.sql");
  }

  const semStart = localYMD(new Date(openSem.started_at));
  const semEnd = localYMD();
  const closingSem = {
    startedAt: openSem.started_at,
    endedAt: null,
    rangeStartYmd: semStart,
    rangeEndYmd: semEnd,
  };

  const [{ data: students }, { data: readings }, { data: diaries }, { data: speaking }] = await Promise.all([
    supabase.from("students").select("*"),
    supabase.from("reading_records").select("*").limit(12000),
    supabase.from("diary_records").select("*").limit(12000),
    supabase.from("speaking_scores").select("*").limit(12000),
  ]);

  const { readings: rf, diaries: df, speaking: sf } = filterActivityRowsForSemesterWindow(
    readings || [],
    diaries || [],
    speaking || [],
    closingSem
  );

  const sidSet = new Set();
  for (const r of rf || []) if (r.student_id) sidSet.add(r.student_id);
  for (const r of df || []) if (r.student_id) sidSet.add(r.student_id);
  for (const r of sf || []) if (r.student_id) sidSet.add(r.student_id);
  const studentsForAward = (students || []).filter((s) => s.semester_id === openSem.id || sidSet.has(s.id));

  const awardRows = buildSemesterAwardRows(studentsForAward, rf, df, sf, semStart, semEnd);

  const archivePayload = awardRows.map((r) => {
    const row = {
      semester_id: openSem.id,
      student_name: String(r.displayName ?? "未命名"),
      consecutive_days: finiteIntOrZero(r.consecutiveDays),
      total_words: finiteIntOrZero(r.totalWordsSemester),
      speaking_attendance_rate: finiteNumberOrZero(r.speakingAttendancePct),
      diary_total_count: finiteIntOrZero(r.diaryTotalCount),
      high_word_weeks: finiteIntOrZero(r.highWordWeeks),
    };
    console.log("[semester-archive]", {
      student_name: row.student_name,
      consecutive_days: row.consecutive_days,
      total_words: row.total_words,
      speaking_attendance_rate: row.speaking_attendance_rate,
      diary_total_count: row.diary_total_count,
      high_word_weeks: row.high_word_weeks,
    });
    return row;
  });

  if (archivePayload.length) {
    const { error: archErr } = await supabase.from("semester_student_stats").insert(archivePayload);
    if (archErr) throw new Error(`归档失败，已中止清空：${archErr.message}`);
  }

  const nowIso = new Date().toISOString();
  const endPatch = { ended_at: nowIso, archived_at: nowIso, is_current: false };
  const { error: e1 } = await supabase.from("semesters").update(endPatch).eq("id", openSem.id);
  if (e1) {
    const msg = String(e1.message || "");
    if (msg.includes("is_current") || msg.includes("schema cache")) {
      const { error: e1b } = await supabase.from("semesters").update({ ended_at: nowIso, archived_at: nowIso }).eq("id", openSem.id);
      if (e1b) throw new Error(`结束学期失败：${e1b.message}`);
    } else {
      throw new Error(`结束学期失败：${e1.message}`);
    }
  }

  const label = (nextTermLabel && String(nextTermLabel).trim()) || `学期 ${localYMD()}`;
  const nextYmd = nextStartedAtYmd && String(nextStartedAtYmd).trim().slice(0, 10);
  const nextStartIso =
    nextYmd && /^\d{4}-\d{2}-\d{2}$/.test(nextYmd) ? localYmdToNoonIsoString(nextYmd) : nowIso;

  const insertRow = {
    term_label: label,
    started_at: nextStartIso,
    is_current: true,
    ended_at: null,
  };
  let ins = await supabase.from("semesters").insert(insertRow).select("*").single();
  if (ins.error) {
    const msg = String(ins.error.message || "");
    if (msg.includes("is_current") || msg.includes("schema cache")) {
      ins = await supabase
        .from("semesters")
        .insert({ term_label: label, started_at: nextStartIso, ended_at: null })
        .select("*")
        .single();
    }
  }
  if (ins.error) throw new Error(`创建新学期失败：${ins.error.message}`);

  return { ok: true, archivedSemesterId: openSem.id, archivedRows: archivePayload.length };
}
