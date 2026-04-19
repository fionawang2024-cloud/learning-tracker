"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ensureCurrentSemester, listAllDiaryRecordsForFeed, listStudents } from "@/lib/db";
import { normalizeDiaryDaysArray } from "@/lib/diaryDate";
import { addDaysYMD, localYMD, sundayOfWeekContaining, weekDatesSundayToSaturday } from "@/lib/dateRangeUtils";
import { WEEKDAY_HEADERS_CN } from "@/lib/teacherReadingCalendar";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import AddStudentBar from "@/components/AddStudentBar";

const DIARY_COL = {
  name: "w-[15%] min-w-0 max-w-[9rem]",
  time: "w-[18%] min-w-0 whitespace-nowrap",
  calendar: "w-[52%] min-w-0",
  save: "w-[15%] min-w-[5.5rem]",
};

function latestDiaryRowForStudent(diaries, studentId) {
  let best = null;
  for (const row of diaries) {
    if (row.student_id !== studentId) continue;
    if (!best || String(row.created_at || "") > String(best.created_at || "")) best = row;
  }
  return best;
}

export default function DiaryRecordsTable({ refreshKey = 0 }) {
  const [diaryStudents, setDiaryStudents] = useState([]);
  const [diaries, setDiaries] = useState([]);
  /** @type {Record<string, string[]>} */
  const [editableByStudent, setEditableByStudent] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [hint, setHint] = useState("");
  const [saveError, setSaveError] = useState("");

  const [diaryWeekSunday, setDiaryWeekSunday] = useState(() => sundayOfWeekContaining(localYMD()));
  const diaryWeekDates = useMemo(() => weekDatesSundayToSaturday(diaryWeekSunday), [diaryWeekSunday]);

  const load = useCallback(async (opts = {}) => {
    const reason = opts.reason || "unknown";
    const preserveStudent = opts.preserveStudent || null;
    console.log("[diary] refreshData called", {
      reason,
      preserveStudentId: preserveStudent?.id ?? null,
      preserveStudentName: preserveStudent?.display_name || preserveStudent?.name || "",
    });
    setSaveError("");
    try {
      const sem = await ensureCurrentSemester();
      const currentSemesterId = sem?.id ?? null;
      console.log("[diary] reload students start", { currentSemesterId });
      const [s, d] = await Promise.all([listStudents(), listAllDiaryRecordsForFeed()]);
      const roster = s || [];
      console.log("[diary] refreshData result names", roster.map((x) => x.display_name || x.name || ""));
      console.log("[diary] reload students result", {
        currentSemesterId,
        studentsCount: roster.length,
        studentNames: roster.map((x) => x.display_name || x.name || ""),
      });
      const allowed = new Set(roster.map((x) => x.id));
      setDiaryStudents((prev) => {
        let next = roster;
        const prevNames = (prev || []).map((x) => x.display_name || x.name || "");
        if (reason === "add_student") {
          const byId = new Map();
          for (const row of prev || []) byId.set(row?.id, row);
          for (const row of roster || []) byId.set(row?.id, row);
          next = Array.from(byId.values()).sort((a, b) =>
            String(a?.display_name || a?.name || "").localeCompare(String(b?.display_name || b?.name || ""), "zh-Hans-CN")
          );
        }
        if (preserveStudent?.id && !roster.some((x) => x.id === preserveStudent.id)) {
          // 避免“添加后瞬间刷新”用旧查询结果把新学生覆盖掉。
          const byId = new Map();
          for (const row of next || []) byId.set(row?.id, row);
          byId.set(preserveStudent.id, preserveStudent);
          next = Array.from(byId.values()).sort((a, b) =>
            String(a?.display_name || a?.name || "").localeCompare(String(b?.display_name || b?.name || ""), "zh-Hans-CN")
          );
        }
        console.log("[diary] before add names", prevNames);
        const nextNames = (next || []).map((x) => x.display_name || x.name || "");
        console.log("[diary] after add names", nextNames);
        return next;
      });
      setDiaries((d || []).filter((row) => allowed.has(row.student_id)));
      const next = {};
      for (const st of s || []) {
        const row = latestDiaryRowForStudent(d || [], st.id);
        next[st.id] = row ? normalizeDiaryDaysArray(row) : [];
      }
      if (preserveStudent?.id && !Object.prototype.hasOwnProperty.call(next, preserveStudent.id)) {
        next[preserveStudent.id] = [];
      }
      setEditableByStudent(next);
    } catch (e) {
      console.error("DiaryRecordsTable load", e);
      setSaveError(e?.message || "加载失败（已保留当前学生列表）");
      // 保留当前页面的学生与日记状态，避免接口异常时清空 UI。
      setDiaryStudents((prev) => prev);
      setDiaries((prev) => prev);
      setEditableByStudent((prev) => prev);
    }
  }, []);

  useEffect(() => {
    void load({ reason: "effect_load" });
  }, [load, refreshKey, diaryWeekSunday]);

  function toggleDay(studentId, ymd) {
    setEditableByStudent((prev) => {
      const cur = [...(prev[studentId] || [])];
      const set = new Set(cur.map((x) => String(x).slice(0, 10)));
      if (set.has(ymd)) set.delete(ymd);
      else set.add(ymd);
      return { ...prev, [studentId]: Array.from(set).sort() };
    });
  }

  async function saveRow(studentId) {
    const days = editableByStudent[studentId] || [];
    setSavingId(studentId);
    setHint("");
    setSaveError("");
    try {
      const res = await fetch("/api/diary/set-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: studentId, diary_days: days }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setHint("已保存");
      await load({ reason: "save_row" });
    } catch (e) {
      console.error(e);
      setSaveError(e?.message || "保存失败");
    } finally {
      setSavingId(null);
    }
  }

  const latestTimeByStudent = useMemo(() => {
    const m = new Map();
    for (const row of diaries) {
      const sid = row.student_id;
      const t = String(row.updated_at || row.created_at || "");
      const prev = m.get(sid) || "";
      if (t > prev) m.set(sid, t);
    }
    return m;
  }, [diaries]);

  const renderedDiaryRows = useMemo(
    () =>
      (diaryStudents || []).map((s) => ({
        id: s.id,
        student: s,
        name: s.display_name || s.name || "—",
        latestUploadedAt: latestTimeByStudent.get(s.id) || null,
        editableDiaryDays: editableByStudent[s.id] || [],
      })),
    [diaryStudents, latestTimeByStudent, editableByStudent, diaryWeekSunday]
  );

  useEffect(() => {
    console.log("[diary] render source count", renderedDiaryRows.length);
    console.log(
      "[diary] render source names",
      renderedDiaryRows.map((x) => x.name)
    );
    console.log(
      "[diary] final render names",
      renderedDiaryRows.map((x) => x.name)
    );
  }, [renderedDiaryRows]);

  const weekRangeLabel =
    diaryWeekDates.length >= 7 ? `${diaryWeekDates[0]} ～ ${diaryWeekDates[6]}` : "—";

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <CardTitle>日记记录</CardTitle>
            <CardDescription>按自然周（周日～周六）勾选完成日，每行单独保存</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" className="text-xs" onClick={() => setDiaryWeekSunday(addDaysYMD(diaryWeekSunday, -7))}>
              上一周
            </Button>
            <Button type="button" variant="secondary" className="text-xs" onClick={() => setDiaryWeekSunday(addDaysYMD(diaryWeekSunday, 7))}>
              下一周
            </Button>
            <Button type="button" variant="secondary" className="text-xs" onClick={() => setDiaryWeekSunday(sundayOfWeekContaining(localYMD()))}>
              本周
            </Button>
          </div>
        </div>
        <AddStudentBar
          variant="diary"
          onAdded={async (student) => {
            console.log("[diary] newStudent", {
              id: student?.id,
              name: student?.display_name || student?.name || "",
              semester_id: student?.semester_id ?? null,
            });
            console.log("[diary] addStudent success -> newStudent", {
              id: student?.id,
              name: student?.display_name || student?.name || "",
              semester_id: student?.semester_id ?? null,
            });
            setDiaryStudents((prev) => {
              const before = (prev || []).map((x) => x.display_name || x.name || "");
              console.log("[diary] before add names", before);
              const sid = student?.id;
              if (!sid) return prev;
              if (prev.some((x) => x.id === sid)) return prev;
              const appended = [...prev, student].sort((a, b) =>
                String(a?.display_name || a?.name || "").localeCompare(String(b?.display_name || b?.name || ""), "zh-Hans-CN")
              );
              const after = appended.map((x) => x.display_name || x.name || "");
              console.log("[diary] after add names", after);
              return appended;
            });
            setEditableByStudent((prev) => ({
              ...prev,
              [student?.id]: prev[student?.id] || [],
            }));
            await load({ reason: "add_student", preserveStudent: student });
          }}
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {saveError && <p className="text-sm text-red-600">{saveError}</p>}
        {hint && <p className="text-sm text-teal-700">{hint}</p>}
        <p className="text-xs text-gray-500">当前显示周：{weekRangeLabel}</p>
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
          <Table tableClassName="table-fixed">
            <TableHeader>
              <TableRow header>
                <TableHead className={DIARY_COL.name}>学生名字</TableHead>
                <TableHead className={DIARY_COL.time}>最新上传时间</TableHead>
                <TableHead className={DIARY_COL.calendar}>日记勾选（{weekRangeLabel}）</TableHead>
                <TableHead className={DIARY_COL.save}>保存</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {renderedDiaryRows.map((row) => {
                const s = row.student;
                const days = row.editableDiaryDays || [];
                const set = new Set(days);
                const t = row.latestUploadedAt;
                return (
                  <TableRow key={s.id}>
                    <TableCell className={`font-medium break-words ${DIARY_COL.name}`}>
                      {s.display_name || s.name || "—"}
                    </TableCell>
                    <TableCell className={`text-gray-600 ${DIARY_COL.time}`}>
                      {t ? t.slice(0, 16).replace("T", " ") : "暂无"}
                    </TableCell>
                    <TableCell className={DIARY_COL.calendar}>
                      <div className="space-y-1">
                        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-gray-600">
                          {WEEKDAY_HEADERS_CN.map((label) => (
                            <div key={label} className="py-0.5">
                              {label}
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {diaryWeekDates.map((d) => {
                            const on = set.has(d);
                            return (
                              <button
                                key={d}
                                type="button"
                                onClick={() => toggleDay(s.id, d)}
                                className={`shrink-0 min-h-[2.5rem] rounded-lg text-xs border transition-colors ${
                                  on
                                    ? "bg-teal-500 text-white border-teal-500 shadow-sm"
                                    : "bg-white border-gray-200 text-gray-600 hover:border-teal-300"
                                }`}
                              >
                                <div className="font-medium">{d.slice(8, 10).replace(/^0/, "") || d.slice(8)}</div>
                                <div className="text-[10px] opacity-80">{d.slice(5)}</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className={DIARY_COL.save}>
                      <Button
                        type="button"
                        className="whitespace-nowrap !px-3 !py-2 text-xs"
                        disabled={savingId === s.id}
                        onClick={() => void saveRow(s.id)}
                      >
                        {savingId === s.id ? "保存中…" : "保存"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {renderedDiaryRows.length === 0 && (
          <p className="text-sm text-gray-500">暂无学生，请点击上方「添加学生」，或通过阅读记录保存时自动创建。</p>
        )}
      </CardContent>
    </Card>
  );
}
