/**
 * 学期归档 Excel：学期信息 + 每周统计 + 期末评奖（与统计页同一套聚合函数）。
 */

import * as XLSX from "xlsx";
import { addDaysYMD, localYMD, sundayOfWeekContaining } from "./dateRangeUtils";
import { computeRangeStatsFromTables } from "./completionStats";
import { buildSemesterAwardRows, filterActivityRowsForSemesterWindow } from "./semesterAwardStats";

/**
 * @param {{
 *   semesterRow: { id: string, term_label?: string|null, started_at: string, ended_at?: string|null },
 *   students: object[],
 *   readings: object[],
 *   diaries: object[],
 *   speaking: object[],
 * }} params
 * @returns {Buffer}
 */
export function buildSemesterReportBuffer({ semesterRow, students, readings, diaries, speaking }) {
  const semStartYmd = localYMD(new Date(semesterRow.started_at));
  const semEndYmd = semesterRow.ended_at ? localYMD(new Date(semesterRow.ended_at)) : localYMD();

  const semWin = {
    startedAt: semesterRow.started_at,
    endedAt: semesterRow.ended_at || null,
    rangeStartYmd: semStartYmd,
    rangeEndYmd: semEndYmd,
  };
  const { readings: rf, diaries: df, speaking: sf } = filterActivityRowsForSemesterWindow(
    readings || [],
    diaries || [],
    speaking || [],
    semWin
  );

  const studentsSorted = [...(students || [])].sort((a, b) =>
    String(a.display_name || a.name || "").localeCompare(String(b.display_name || b.name || ""), "zh-CN")
  );

  const wb = XLSX.utils.book_new();
  const exportTimeIso = new Date().toISOString();

  const meta = [
    ["学期名称/标签", semesterRow.term_label || ""],
    ["学期起始日", semStartYmd],
    ["学期结束日", semEndYmd],
    ["导出时间", exportTimeIso],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), "学期信息");

  const weeklyHeader = [
    "周次",
    "起始日期",
    "结束日期",
    "学生姓名",
    "本周阅读小时",
    "本周新单词",
    "本周日记",
    "本周口语课参与",
    "本周完成情况",
  ];
  const weeklyAoa = [weeklyHeader];

  let sun = sundayOfWeekContaining(semStartYmd);
  let weekIdx = 0;
  for (;;) {
    if (sun > semEndYmd) break;
    const sat = addDaysYMD(sun, 6);
    const interStart = sun < semStartYmd ? semStartYmd : sun;
    const interEnd = sat > semEndYmd ? semEndYmd : sat;
    if (interStart <= interEnd) {
      weekIdx += 1;
      const weekRows = computeRangeStatsFromTables(studentsSorted, rf, df, sf, interStart, interEnd);
      for (const row of weekRows) {
        weeklyAoa.push([
          weekIdx,
          interStart,
          interEnd,
          row.displayName,
          row.rangeReadingHours == null ? "" : row.rangeReadingHours,
          row.rangeNewWords,
          row.rangeDiaryLabel,
          row.speakingLabel,
          row.rangeCompletionLabel,
        ]);
      }
    }
    sun = addDaysYMD(sun, 7);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(weeklyAoa), "每周统计");

  const awardRows = buildSemesterAwardRows(studentsSorted, rf, df, sf, semStartYmd, semEndYmd);
  const awardHeader = [
    "学生姓名",
    "连续天数",
    "阅读总单词量",
    "口语课出勤率",
    "日记总篇数",
    "日均单词过千周数",
    "完成任务周数",
  ];
  const awardAoa = [
    awardHeader,
    ...awardRows.map((r) => [
      r.displayName,
      r.consecutiveDays,
      r.totalWordsSemester,
      r.speakingAttendancePct == null || !Number.isFinite(r.speakingAttendancePct)
        ? ""
        : `${r.speakingAttendancePct}%`,
      r.diaryTotalCount,
      r.highWordWeeks,
      r.completedTaskWeeksLabel ?? "",
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(awardAoa), "期末评奖统计");

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
