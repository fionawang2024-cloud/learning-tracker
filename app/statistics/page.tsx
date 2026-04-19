"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import {
  ensureCurrentSemester,
  getCurrentSemesterAwardStats,
  getCurrentSemesterInfo,
  getRangeStats,
  updateCurrentSemesterStartYmd,
} from "@/lib/db";
import AddStudentBar from "@/components/AddStudentBar";
import { Button } from "@/components/ui/Button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import {
  formatChineseRangeLabel,
  localYMD,
  sundayOfWeekContaining,
  shiftSundayWeekRange,
  thisWeekRange,
} from "@/lib/dateRangeUtils";
import {
  formatStatCumulativeReadingMinutes,
  formatStatDiaryLabel,
  formatStatNumber,
  formatStatPercent,
  formatStatSpeakingLabel,
} from "@/lib/formatStatDisplay";

type RangeRow = {
  studentId: string;
  displayName: string;
  cumulativeTotalTimeMinutes: number | null;
  rangeReadingHours: number | null;
  totalReadingWords: number;
  rangeNewWords: number;
  rangeDiaryLabel: string;
  speakingLabel: string;
  rangeCompletionLabel: string;
  totalCompletedDays: number;
};

type AwardRow = {
  studentId: string;
  displayName: string;
  consecutiveDays: number;
  totalWordsSemester: number;
  speakingAttendancePct: number | null;
  diaryTotalCount: number;
  highWordWeeks: number;
  completedTaskWeeksLabel: string;
};

type SemInfo = {
  id: string;
  termLabel: string;
  startedAt: string;
  endedAt?: string | null;
  rangeStartYmd: string;
  rangeEndYmd: string;
};

const STAT_COL = {
  c1: "w-[14%] min-w-0",
  c2: "w-[11%] min-w-0",
  c3: "w-[13%] min-w-0",
  c4: "w-[11%] min-w-0",
  c5: "w-[13%] min-w-0",
  c6: "w-[11%] min-w-0",
  c7: "w-[27%] min-w-0",
} as const;

const AW_COL = {
  c1: "w-[12%] min-w-0",
  c2: "w-[10%] min-w-0",
  c3: "w-[12%] min-w-0",
  c4: "w-[12%] min-w-0",
  c5: "w-[10%] min-w-0",
  c6: "w-[14%] min-w-0",
  c7: "w-[14%] min-w-0",
} as const;

/** 完成天数不足时浅红提示；其余默认背景；hover 不盖住红色 */
function rangeStatsRowClassName(r: RangeRow) {
  if ((r.totalCompletedDays ?? 0) < 7) return "bg-rose-50 hover:bg-rose-50";
  return "";
}

export default function StatisticsPage() {
  const tw = thisWeekRange();
  const [rangeStart, setRangeStart] = useState(tw.start);
  const [rangeEnd, setRangeEnd] = useState(tw.end);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [rows, setRows] = useState<RangeRow[]>([]);
  const [awardRows, setAwardRows] = useState<AwardRow[]>([]);
  const [semInfo, setSemInfo] = useState<SemInfo | null>(null);

  const [loading, setLoading] = useState(true);
  const [awardLoading, setAwardLoading] = useState(true);
  const [err, setErr] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const rangeTableRef = useRef<HTMLDivElement | null>(null);
  const awardTableRef = useRef<HTMLDivElement | null>(null);

  const [showSemesterModal, setShowSemesterModal] = useState(false);
  const [nextTermLabel, setNextTermLabel] = useState("");
  const [nextSemStartYmd, setNextSemStartYmd] = useState("");
  const [semesterBusy, setSemesterBusy] = useState(false);

  const [semStartDraft, setSemStartDraft] = useState("");
  const [saveSemBusy, setSaveSemBusy] = useState(false);

  const loadRange = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await getRangeStats(rangeStart, rangeEnd);
      setRows((data || []) as RangeRow[]);
    } catch (e: unknown) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd]);

  const loadAwardAndSem = useCallback(async () => {
    setAwardLoading(true);
    try {
      try {
        await ensureCurrentSemester();
      } catch {
        /* 表未建时 ensure 失败 */
      }
      const [aw, info] = await Promise.all([getCurrentSemesterAwardStats(), getCurrentSemesterInfo()]);
      setAwardRows((aw || []) as AwardRow[]);
      setSemInfo(info as SemInfo | null);
    } catch (e: unknown) {
      console.error(e);
    } finally {
      setAwardLoading(false);
    }
  }, [refreshKey]);

  useEffect(() => {
    void loadRange();
  }, [loadRange]);

  useEffect(() => {
    void loadAwardAndSem();
  }, [loadAwardAndSem]);

  async function exportRangePng() {
    const el = rangeTableRef.current;
    if (!el) return;
    try {
      const dataUrl = await toPng(el, { pixelRatio: 2, backgroundColor: "#ffffff" });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "range-stats.png";
      a.click();
    } catch (e: unknown) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "导出失败");
    }
  }

  async function exportAwardPng() {
    const el = awardTableRef.current;
    if (!el) return;
    try {
      const dataUrl = await toPng(el, { pixelRatio: 2, backgroundColor: "#ffffff" });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "semester-awards-stats.png";
      a.click();
    } catch (e: unknown) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "导出失败");
    }
  }

  function applyThisWeek() {
    const t = thisWeekRange();
    setRangeStart(t.start);
    setRangeEnd(t.end);
  }

  function applyPrevWeek() {
    const sun = sundayOfWeekContaining(rangeStart);
    const { start, end } = shiftSundayWeekRange(sun, -1);
    setRangeStart(start);
    setRangeEnd(end);
  }

  function applyNextWeek() {
    const sun = sundayOfWeekContaining(rangeStart);
    const { start, end } = shiftSundayWeekRange(sun, 1);
    setRangeStart(start);
    setRangeEnd(end);
  }

  function applyCustomRange() {
    const a = String(customStart).slice(0, 10);
    const b = String(customEnd).slice(0, 10);
    if (!a || !b) {
      setErr("请选择自定义开始与结束日期");
      return;
    }
    if (a > b) {
      setErr("开始日期不能晚于结束日期");
      return;
    }
    setErr("");
    setRangeStart(a);
    setRangeEnd(b);
  }

  async function confirmStartNewSemester() {
    if (!semInfo?.id) {
      setErr("无法开始新学期：未找到当前学期记录");
      return;
    }
    const semesterIdToExport = semInfo.id;
    setSemesterBusy(true);
    setErr("");
    try {
      const exportRes = await fetch(
        `/api/export-semester-report?semesterId=${encodeURIComponent(semesterIdToExport)}`
      );
      if (!exportRes.ok) {
        const j = (await exportRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(j?.error || `导出学期报表失败 ${exportRes.status}`);
      }
      const blob = await exportRes.blob();
      const dispo = exportRes.headers.get("Content-Disposition");
      const m = dispo?.match(/filename="?([^";]+)"?/i);
      const fallbackName = `semester-report-${semInfo.rangeStartYmd}_to_${localYMD()}.xlsx`;
      const name = (m?.[1] && String(m[1]).trim()) || fallbackName;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const y = nextSemStartYmd.trim().slice(0, 10);
      const res = await fetch("/api/semester/start-new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nextTermLabel: nextTermLabel.trim() || undefined,
          nextStartedAtYmd: /^\d{4}-\d{2}-\d{2}$/.test(y) ? y : undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || body.ok === false) {
        throw new Error(body?.error || `开启新学期失败 ${res.status}`);
      }
      setShowSemesterModal(false);
      setNextTermLabel("");
      setNextSemStartYmd("");
      applyThisWeek();
      setRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "开启新学期失败");
    } finally {
      setSemesterBusy(false);
    }
  }

  async function saveSemesterStart() {
    const y = semStartDraft.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(y)) {
      setErr("请选择有效的学期起始日");
      return;
    }
    setSaveSemBusy(true);
    setErr("");
    try {
      const info = await updateCurrentSemesterStartYmd(y);
      setSemInfo(info as SemInfo | null);
      setRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaveSemBusy(false);
    }
  }

  function reloadAll() {
    void loadRange();
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold text-gray-900">完成情况统计</h1>
          <p className="text-sm text-gray-500">按所选时间范围汇总；下方评奖表固定为当前学期累计。</p>
          {semInfo ? (
            <p className="text-sm text-gray-700">
              当前学期：<span className="font-medium">{semInfo.termLabel}</span>（自 {semInfo.rangeStartYmd} 起）
            </p>
          ) : (
            <p className="text-sm text-amber-700">未配置学期表时，评奖表与学期起始日可能不可用，请执行 supabase_schema_semesters.sql。</p>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end lg:max-w-2xl">
          <AddStudentBar variant="statistics" onAdded={() => reloadAll()} />
          <Button type="button" variant="secondary" onClick={() => setShowSemesterModal(true)}>
            开始新学期
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        <div className="text-sm font-medium text-gray-800">统计范围</div>
        <p className="text-xs text-gray-500">{formatChineseRangeLabel(rangeStart, rangeEnd)}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className="text-sm" onClick={applyPrevWeek}>
            上一周
          </Button>
          <Button type="button" variant="secondary" className="text-sm" onClick={applyNextWeek}>
            下一周
          </Button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="text-xs text-gray-600 shrink-0">自定义</label>
          <input
            type="date"
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
          />
          <span className="text-gray-400">—</span>
          <input
            type="date"
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
          />
          <Button type="button" variant="secondary" className="text-sm" onClick={applyCustomRange}>
            应用
          </Button>
        </div>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-medium text-gray-900">本周整体完成情况</h2>
          <Button type="button" variant="secondary" onClick={() => void exportRangePng()} disabled={loading || !rows.length}>
            导出当前表为图片
          </Button>
        </div>
        {loading && <p className="text-sm text-gray-500">加载中…</p>}
        <div
          ref={rangeTableRef}
          className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden p-4"
        >
          <div className="overflow-x-auto rounded-lg bg-white">
            <Table tableClassName="table-fixed min-w-[720px]">
              <TableHeader>
                <TableRow header>
                  <TableHead className={STAT_COL.c1}>学生姓名</TableHead>
                  <TableHead className={STAT_COL.c2}>总阅读小时</TableHead>
                  <TableHead className={STAT_COL.c3}>总阅读单词量</TableHead>
                  <TableHead className={STAT_COL.c4}>本周新单词</TableHead>
                  <TableHead className={STAT_COL.c5}>本周日记</TableHead>
                  <TableHead className={STAT_COL.c6}>口语课参与</TableHead>
                  <TableHead className={STAT_COL.c7}>本周完成情况</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.studentId} className={rangeStatsRowClassName(r)}>
                    <TableCell className={`break-words font-medium ${STAT_COL.c1}`}>{r.displayName}</TableCell>
                    <TableCell className={`break-words tabular-nums ${STAT_COL.c2}`}>
                      {formatStatCumulativeReadingMinutes(r.cumulativeTotalTimeMinutes)}
                    </TableCell>
                    <TableCell className={`break-words tabular-nums ${STAT_COL.c3}`}>
                      {formatStatNumber(r.totalReadingWords)}
                    </TableCell>
                    <TableCell className={`break-words tabular-nums ${STAT_COL.c4}`}>
                      {formatStatNumber(r.rangeNewWords)}
                    </TableCell>
                    <TableCell className={`break-words ${STAT_COL.c5}`}>
                      {formatStatDiaryLabel(r.rangeDiaryLabel)}
                    </TableCell>
                    <TableCell className={`break-words ${STAT_COL.c6}`}>
                      {formatStatSpeakingLabel(r.speakingLabel)}
                    </TableCell>
                    <TableCell className={`break-words ${STAT_COL.c7}`}>{r.rangeCompletionLabel}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {!loading && rows.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">暂无数据</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900">整学期评奖统计</h2>
            <p className="text-xs text-gray-500 mt-1">
              固定统计当前学期；连续天数=学期内阅读日最长连续段；日均单词过千周数=自然周（周日～周六）内该周新单词合计大于 7000
              的周数；完成任务周数=学期内与学期有交集的每个自然周中，7 个日历日全部落在学期内且每日（阅读或日记）至少完成其一的周数 / 总周数。
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={() => void exportAwardPng()} disabled={awardLoading || !awardRows.length}>
            导出评奖表为图片
          </Button>
        </div>
        {awardLoading && <p className="text-sm text-gray-500">加载评奖数据…</p>}
        <div
          ref={awardTableRef}
          className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden p-4"
        >
          <div className="overflow-x-auto rounded-lg bg-white">
            <Table tableClassName="table-fixed min-w-[760px]">
              <TableHeader>
                <TableRow header>
                  <TableHead className={AW_COL.c1}>学生姓名</TableHead>
                  <TableHead className={AW_COL.c2}>连续天数</TableHead>
                  <TableHead className={AW_COL.c3}>阅读总单词量</TableHead>
                  <TableHead className={AW_COL.c4}>口语课出勤率</TableHead>
                  <TableHead className={AW_COL.c5}>日记总篇数</TableHead>
                  <TableHead className={AW_COL.c6}>日均单词过千周数</TableHead>
                  <TableHead className={AW_COL.c7}>完成任务周数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {awardRows.map((r) => (
                  <TableRow key={r.studentId}>
                    <TableCell className={`break-words font-medium ${AW_COL.c1}`}>{r.displayName}</TableCell>
                    <TableCell className={`tabular-nums ${AW_COL.c2}`}>
                      {formatStatNumber(r.consecutiveDays)}
                    </TableCell>
                    <TableCell className={`tabular-nums ${AW_COL.c3}`}>
                      {formatStatNumber(r.totalWordsSemester)}
                    </TableCell>
                    <TableCell className={AW_COL.c4}>{formatStatPercent(r.speakingAttendancePct)}</TableCell>
                    <TableCell className={`tabular-nums ${AW_COL.c5}`}>
                      {formatStatNumber(r.diaryTotalCount)}
                    </TableCell>
                    <TableCell className={`tabular-nums ${AW_COL.c6}`}>
                      {formatStatNumber(r.highWordWeeks)}
                    </TableCell>
                    <TableCell className={`tabular-nums ${AW_COL.c7}`}>{r.completedTaskWeeksLabel}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {!awardLoading && awardRows.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">暂无学生</p>
          )}
        </div>
      </section>

      {showSemesterModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-md w-full rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">开始新学期</h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              确认后将先自动下载当前学期的 Excel 报表（含每周统计与期末评奖汇总）。学生与阅读、日记、口语等原始记录均会保留，不会删除。新学期创建后，页面统计将只统计新学期的数据。
            </p>
            <div>
              <label className="text-xs text-gray-500">新学期名称（可选）</label>
              <input
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="例如：2026 秋季学期"
                value={nextTermLabel}
                onChange={(e) => setNextTermLabel(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">新学期起始日（可选，不填则从今天起）</label>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={nextSemStartYmd}
                onChange={(e) => setNextSemStartYmd(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" disabled={semesterBusy} onClick={() => setShowSemesterModal(false)}>
                取消
              </Button>
              <Button type="button" disabled={semesterBusy || !semInfo?.id} onClick={() => void confirmStartNewSemester()}>
                {semesterBusy ? "导出并开启中…" : "下载报表并开启新学期"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
