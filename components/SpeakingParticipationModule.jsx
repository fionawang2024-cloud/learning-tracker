"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDaysYMD,
  formatChineseRangeLabel,
  localYMD,
  sundayOfWeekContaining,
  sundayToSaturdayWeekRangeForSunday,
} from "@/lib/dateRangeUtils";
import { listSpeakingScoresInRange, listStudents } from "@/lib/db";
import { isSpeakingExcusedLeave } from "@/lib/speakingStatus";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

/** 与日记模块一致：该周口语统一写入 score_date = 当周周日（周标识日），统计按日落在周日～周六区间内即可命中 */
function formatSpeakingRowLabel(row, nameById) {
  const sid = row.student_id;
  const name = nameById.get(sid) || "未知";
  if (isSpeakingExcusedLeave(row)) return `${name}：请假`;
  const st = String(row.status || "").trim();
  if (st === "present" || st === "") {
    if (row.score != null && String(row.score).trim() !== "") {
      const n = Number(row.score);
      if (Number.isFinite(n)) return `${name}：${n}`;
    }
  }
  return null;
}

export default function SpeakingParticipationModule({ onSaved, refreshKey = 0 }) {
  const [speakingWeekSunday, setSpeakingWeekSunday] = useState(() => sundayOfWeekContaining(localYMD()));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [err, setErr] = useState("");
  const [weekRows, setWeekRows] = useState([]);
  const [loadErr, setLoadErr] = useState("");

  const weekRange = useMemo(
    () => sundayToSaturdayWeekRangeForSunday(speakingWeekSunday),
    [speakingWeekSunday]
  );
  const weekRangeLabel = useMemo(
    () => formatChineseRangeLabel(weekRange.start, weekRange.end),
    [weekRange.start, weekRange.end]
  );

  const loadWeekScores = useCallback(async () => {
    setLoadErr("");
    try {
      const [students, rows] = await Promise.all([
        listStudents(),
        listSpeakingScoresInRange(weekRange.start, weekRange.end),
      ]);
      const nameById = new Map((students || []).map((s) => [s.id, s.display_name || s.name || ""]));
      const allowed = new Set((students || []).map((s) => s.id));
      const lines = [];
      const seen = new Set();
      for (const row of rows || []) {
        const sid = row.student_id;
        if (!sid || !allowed.has(sid) || seen.has(sid)) continue;
        seen.add(sid);
        const line = formatSpeakingRowLabel(row, nameById);
        if (line) lines.push(line);
      }
      lines.sort((a, b) => a.localeCompare(b, "zh-CN"));
      setWeekRows(lines);
    } catch (e) {
      console.error(e);
      setLoadErr(e?.message || "加载本周口语记录失败");
      setWeekRows([]);
    }
  }, [weekRange.start, weekRange.end]);

  useEffect(() => {
    void loadWeekScores();
  }, [loadWeekScores, refreshKey]);

  function handlePrevSpeakingWeek() {
    setSpeakingWeekSunday(addDaysYMD(speakingWeekSunday, -7));
  }

  function handleNextSpeakingWeek() {
    setSpeakingWeekSunday(addDaysYMD(speakingWeekSunday, 7));
  }

  function handleCurrentSpeakingWeek() {
    setSpeakingWeekSunday(sundayOfWeekContaining(localYMD()));
  }

  async function ingest() {
    setBusy(true);
    setHint("");
    setErr("");
    try {
      const res = await fetch("/api/speaking/bulk-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText: text,
          scoreDate: weekRange.start,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const lines = [];
      if (Array.isArray(body.errors) && body.errors.length) {
        lines.push(...body.errors);
      }
      setHint(lines.length ? `录入成功（部分提示：${lines.join("；")}）` : "录入成功");
      setText("");
      onSaved?.();
      await loadWeekScores();
    } catch (e) {
      console.error(e);
      setErr(e?.message || "录入失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2 flex-1">
          <div>
            <CardTitle>口语课参与度</CardTitle>
            <CardDescription>
              按自然周（周日～周六）录入；格式：学生姓名：分数（0–5）或学生姓名：请假。当前周数据写入该周周日对应的上课日。
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" className="text-xs" onClick={handlePrevSpeakingWeek}>
              上一周
            </Button>
            <Button type="button" variant="secondary" className="text-xs" onClick={handleCurrentSpeakingWeek}>
              本周
            </Button>
            <Button type="button" variant="secondary" className="text-xs" onClick={handleNextSpeakingWeek}>
              下一周
            </Button>
            <span className="text-sm text-gray-700 tabular-nums">{weekRangeLabel}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          className="w-full min-h-[140px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-400"
          placeholder={"例如：\n张三：5\n李四：请假\n或：张三：5 李四：4"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {loadErr && <p className="text-sm text-amber-700">{loadErr}</p>}
        {weekRows.length > 0 && (
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-800">
            <div className="text-xs font-medium text-gray-600 mb-1">当前周已有记录</div>
            <ul className="list-disc list-inside space-y-0.5">
              {weekRows.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {err && <p className="text-sm text-red-600">{err}</p>}
        {hint && <p className="text-sm text-teal-700">{hint}</p>}
        <Button type="button" onClick={() => void ingest()} disabled={busy}>
          {busy ? "录入中…" : "录入"}
        </Button>
      </CardContent>
    </Card>
  );
}
