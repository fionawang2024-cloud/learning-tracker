"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { toPng } from "html-to-image";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { SEMESTER_START } from "@/lib/constants";
import { fetchTeacherAuthorization } from "@/lib/teacherAuthClient";
import { formatTimeMinutes } from "@/lib/timeFormat";
import { hasDevTeacherAccess } from "@/lib/devMode";
import {
  listStudents,
  updateStudentSpeakingFlag,
  listDiaryByStudent,
  listReadingByStudent,
  listSpeakingByStudent,
  listAllReadingRecordsForFeed,
  listAllDiaryRecordsForFeed,
  updateReadingRecord,
  updateDiaryRecord,
  listSpeakingScoresForStudents,
  upsertSpeakingScoreForClassDate,
  speakingScoreClassDate,
  speakingScoreDateForReport,
} from "@/lib/db";
import {
  buildToggleReadingDaysUpdate,
  normalizeReadingRecordForCalendar,
} from "@/lib/teacherReadingCalendar";
import { FeedReadingWeekCalendar } from "@/components/teacher/FeedReadingWeekCalendar";
import { DiaryWeekDaysPicker } from "@/components/teacher/DiaryWeekDaysPicker";
import { buildActivityFeedItems, filterActivityFeedItems, localYMD } from "@/lib/teacherActivityFeed";
import { formatStudentDisplayName } from "@/lib/studentDisplayName";
import { normalizeDiaryDaysArray } from "@/lib/diaryDate";
import { normalizeReadingDaysArray } from "@/lib/readingRecordOcr";
import { dateInRange, computeWeeklyNewWordsFromReadings } from "@/lib/weeklyReadingWords";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const monOffset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + monOffset);
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildRangeReport(students, startStr, endStr, diaryByStudent, readingByStudent, speakingByStudent) {
  return students.map((s) => {
    const diaries = diaryByStudent[s.id] || [];
    const readings = readingByStudent[s.id] || [];
    const speakings = speakingByStudent[s.id] || [];

    const displayName = formatStudentDisplayName(s);

    const diaryDays = new Set();
    diaries.forEach((r) => {
      normalizeDiaryDaysArray(r).forEach((d) => {
        if (dateInRange(d, startStr, endStr)) diaryDays.add(d);
      });
    });

    const readingDays = new Set();
    readings.forEach((r) => {
      normalizeReadingDaysArray(r.reading_days).forEach((d) => {
        if (dateInRange(d, startStr, endStr)) readingDays.add(d);
      });
    });

    const union = new Set([...diaryDays, ...readingDays]);

    const sumNewWords = computeWeeklyNewWordsFromReadings(readings, startStr, endStr, {
      log: true,
      logCtx: {
        source: "teacher-weekly-report",
        student_id: s.id,
        display_name: displayName,
      },
    });

    const readingsSorted = [...readings].sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );
    const latestSnapshot = readingsSorted.find((r) => {
      const ca = r.created_at?.slice(0, 10);
      return ca && ca <= endStr;
    });
    const cumulativeWords = latestSnapshot != null ? Number(latestSnapshot.total_words) || 0 : 0;
    const cumulativeMinutes = latestSnapshot != null ? Number(latestSnapshot.total_time_minutes) || 0 : 0;

    /** 口语课参与度：区间内 score_date（不用 created_at）上所有分数的数值之和；无记录为 0 */
    const speakingScore = !s.is_speaking_student
      ? "N/A"
      : (() => {
          const inRange = speakings.filter((r) => {
            const d = speakingScoreDateForReport(r);
            return d && dateInRange(d, startStr, endStr);
          });
          const sum = inRange.reduce((acc, r) => acc + (Number(r.score) || 0), 0);
          return sum;
        })();

    const unionCount = union.size;
    const readingCount = readingDays.size;
    const diaryCount = diaryDays.size;
    const completionSummary = `完成${unionCount}天，阅读${readingCount}天，日记${diaryCount}天`;

    return {
      display_name: displayName,
      email: s.email,
      completedDays: unionCount,
      diaryDaysInWeek: diaryCount,
      readingDaysInWeek: readingCount,
      completionSummary,
      sumNewWords,
      cumulativeWords,
      cumulativeMinutes,
      speakingScore:
        typeof speakingScore === "number" ? String(speakingScore) : speakingScore,
    };
  });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatFeedTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16).replace("T", " ");
    return d.toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return String(iso).slice(0, 16).replace("T", " ");
  }
}

function speakingAttendanceStatusLabel(draftStr, savedScore) {
  const v =
    draftStr !== "" && draftStr !== undefined ? draftStr : savedScore != null ? String(savedScore) : "";
  if (v === "") return "未录入";
  const n = parseInt(v, 10);
  if (n === 0) return "缺勤";
  if (n >= 1 && n <= 5) return "出勤";
  return "—";
}

/** 历史出勤率：score 1–5 计作出勤，0 为缺勤；无记录返回 null */
function speakingHistoricalAttendancePercent(allScores, studentId) {
  const mine = allScores.filter((r) => r.student_id === studentId);
  if (mine.length === 0) return null;
  const attended = mine.filter((r) => {
    const n = Number(r.score);
    return n >= 1 && n <= 5;
  }).length;
  return Math.round((attended / mine.length) * 100);
}

export default function TeacherPage() {
  const [user, setUser] = useState(null);
  /** 服务端白名单或开发模式「教师视角」 */
  const [teacherAccessOk, setTeacherAccessOk] = useState(false);
  const [students, setStudents] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(() => {
    const m = getWeekStart(new Date());
    return m.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(todayStr);
  const [report, setReport] = useState([]);
  const [reportRef, setReportRef] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [feedReadings, setFeedReadings] = useState([]);
  const [feedDiaries, setFeedDiaries] = useState([]);
  const [feedNameQuery, setFeedNameQuery] = useState("");
  const [feedRangePreset, setFeedRangePreset] = useState("all");
  const [feedCustomStart, setFeedCustomStart] = useState(() => localYMD());
  const [feedCustomEnd, setFeedCustomEnd] = useState(() => localYMD());
  const [feedTypeFilter, setFeedTypeFilter] = useState("all");
  const [feedStatusFilter, setFeedStatusFilter] = useState("all");
  /** 下方分区：学生列表 | 作业动态（默认学生列表；筛选状态保留在父级 state） */
  const [teacherLowerTab, setTeacherLowerTab] = useState("学生列表");
  /** 作业动态 · 阅读周历：确认后再写 reading_days */
  const [readingDayConfirm, setReadingDayConfirm] = useState(null);
  const [persistingReadingDay, setPersistingReadingDay] = useState(false);
  const [savingDiaryDateId, setSavingDiaryDateId] = useState(null);
  const [speakingCourseDate, setSpeakingCourseDate] = useState(() => localYMD(new Date()));
  const [allSpeakingScores, setAllSpeakingScores] = useState([]);
  const [speakingDraft, setSpeakingDraft] = useState({});
  const [savingSpeakingId, setSavingSpeakingId] = useState(null);

  function applyPreset(preset) {
    const today = new Date();
    if (preset === "本周") {
      const m = getWeekStart(today);
      setStartDate(m.toISOString().slice(0, 10));
      const end = new Date(m);
      end.setDate(m.getDate() + 6);
      setEndDate(end.toISOString().slice(0, 10));
    } else if (preset === "本月") {
      setStartDate(new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10));
      setEndDate(todayStr());
    } else if (preset === "本学期") {
      setStartDate(SEMESTER_START);
      setEndDate(todayStr());
    }
  }

  useEffect(() => {
    (async () => {
      const { data: { user: u } } = await getSupabaseClient().auth.getUser();
      if (!u) {
        setLoading(false);
        return;
      }
      setUser(u);
      let allowed = hasDevTeacherAccess();
      if (!allowed) {
        const { authorized } = await fetchTeacherAuthorization();
        allowed = authorized;
      }
      setTeacherAccessOk(allowed);
      if (!allowed) {
        setLoading(false);
        return;
      }
      const list = await listStudents();
      setStudents(list);
      try {
        const [reads, dias] = await Promise.all([
          listAllReadingRecordsForFeed(),
          listAllDiaryRecordsForFeed(),
        ]);
        setFeedReadings(reads);
        setFeedDiaries(dias);
      } catch (e) {
        console.error("[teacher] activity feed fetch failed", e);
        setFeedReadings([]);
        setFeedDiaries([]);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!students.length || !startDate || !endDate) return;
    if (startDate > endDate) return;
    (async () => {
      const diaryByStudent = {};
      const readingByStudent = {};
      const speakingByStudent = {};
      await Promise.all(
        students.map(async (s) => {
          const [diary, reading, speaking] = await Promise.all([
            listDiaryByStudent(s.id),
            listReadingByStudent(s.id),
            listSpeakingByStudent(s.id),
          ]);
          diaryByStudent[s.id] = diary;
          readingByStudent[s.id] = reading;
          speakingByStudent[s.id] = speaking;
        })
      );
      const r = buildRangeReport(students, startDate, endDate, diaryByStudent, readingByStudent, speakingByStudent);
      setReport(r);
    })();
  }, [students, startDate, endDate]);

  useEffect(() => {
    const ids = students.filter((s) => s.is_speaking_student).map((s) => s.id);
    if (ids.length === 0) {
      setAllSpeakingScores([]);
      return;
    }
    let cancelled = false;
    listSpeakingScoresForStudents(ids)
      .then((rows) => {
        if (!cancelled) setAllSpeakingScores(rows || []);
      })
      .catch((e) => {
        console.error("[teacher] listSpeakingScoresForStudents failed", e);
        if (!cancelled) setAllSpeakingScores([]);
      });
    return () => {
      cancelled = true;
    };
  }, [students]);

  useEffect(() => {
    const next = {};
    for (const s of students.filter((x) => x.is_speaking_student)) {
      const row = allSpeakingScores.find(
        (r) => r.student_id === s.id && speakingScoreClassDate(r) === speakingCourseDate
      );
      next[s.id] = row != null ? String(row.score) : "";
    }
    setSpeakingDraft(next);
  }, [students, allSpeakingScores, speakingCourseDate]);

  useEffect(() => {
    if (!readingDayConfirm) return;
    const onKey = (e) => {
      if (e.key === "Escape" && !persistingReadingDay) setReadingDayConfirm(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readingDayConfirm, persistingReadingDay]);

  async function handleSaveDiaryDaysInFeed(diaryId, days) {
    setSavingDiaryDateId(diaryId);
    try {
      const updated = await updateDiaryRecord(diaryId, { diary_days: days, diary_date: null });
      setFeedDiaries((prev) => prev.map((d) => (d.id === diaryId ? { ...d, ...updated } : d)));
    } catch (e) {
      console.error("[teacher] diary_days update failed", e);
      alert("保存失败，请稍后重试");
    } finally {
      setSavingDiaryDateId(null);
    }
  }

  async function handleConfirmReadingDay() {
    if (!readingDayConfirm || persistingReadingDay) return;
    const { recordId, dateStr } = readingDayConfirm;
    const rec = feedReadings.find((r) => r.id === recordId);
    const norm = rec ? normalizeReadingRecordForCalendar(rec) : null;
    const built = buildToggleReadingDaysUpdate(norm, dateStr);
    if (!built) {
      setReadingDayConfirm(null);
      return;
    }
    setPersistingReadingDay(true);
    try {
      await updateReadingRecord(recordId, { reading_days: built.updatedDays });
      setFeedReadings((prev) =>
        prev.map((r) => (r.id === recordId ? { ...r, reading_days: built.updatedDays } : r))
      );
      setReadingDayConfirm(null);
    } catch (e) {
      console.error("[teacher] feed reading_days update failed", e);
      alert("保存失败，请稍后重试");
    } finally {
      setPersistingReadingDay(false);
    }
  }

  async function handleToggleSpeaking(studentId, current) {
    try {
      const updated = await updateStudentSpeakingFlag(studentId, !current);
      setStudents((prev) => prev.map((s) => (s.id === studentId ? updated : s)));
    } catch (e) {
      console.error(e);
    }
  }

  async function handleSaveSpeakingScore(studentId) {
    const v = speakingDraft[studentId];
    if (v === "" || v === undefined) {
      alert("请先选择参与度分数（0–5）");
      return;
    }
    const score = parseInt(v, 10);
    if (Number.isNaN(score) || score < 0 || score > 5) {
      alert("分数须在 0–5 之间（0=缺勤，1–5=出勤）");
      return;
    }
    setSavingSpeakingId(studentId);
    try {
      console.log("[teacher] speaking save — before upsert:", {
        table: "speaking_scores",
        payload: { student_id: studentId, score_date: speakingCourseDate, score },
        student_id: studentId,
        score_date: speakingCourseDate,
        score,
        onConflict: "student_id,score_date",
      });
      const row = await upsertSpeakingScoreForClassDate(studentId, speakingCourseDate, score);
      setAllSpeakingScores((prev) => {
        const rest = prev.filter(
          (r) => !(r.student_id === studentId && speakingScoreClassDate(r) === speakingCourseDate)
        );
        return [...rest, row];
      });
    } catch (e) {
      console.error("[teacher] upsertSpeakingScoreForClassDate failed raw:", e);
      console.error("[teacher] error.message:", e?.message);
      console.error("[teacher] error.details:", e?.details);
      console.error("[teacher] error.hint:", e?.hint);
      console.error("[teacher] error.code:", e?.code);
      console.error("[teacher] error.status:", e?.status);
      try {
        console.error("[teacher] error serialized:", JSON.stringify(e, Object.getOwnPropertyNames(e ?? {})));
      } catch {
        /* ignore */
      }
      alert(
        `保存失败：${e?.message || "未知错误"}。请确认已在 Supabase 执行 supabase_schema_speaking_score_date.sql。`
      );
    } finally {
      setSavingSpeakingId(null);
    }
  }

  async function handleExportPng() {
    if (!reportRef || exporting) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(reportRef, { backgroundColor: "#ffffff", pixelRatio: 2 });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `周报-${startDate}-${endDate}.png`;
      a.click();
    } catch (e) {
      console.error(e);
    } finally {
      setExporting(false);
    }
  }

  const filteredStudents = searchQuery.trim()
    ? students.filter(
        (s) =>
          formatStudentDisplayName(s).toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.email || "").toLowerCase().includes(searchQuery.toLowerCase())
      )
    : students;

  const speakingStudentsList = useMemo(
    () => students.filter((s) => s.is_speaking_student),
    [students]
  );

  const feedItems = useMemo(
    () => buildActivityFeedItems(feedReadings, feedDiaries, students),
    [feedReadings, feedDiaries, students]
  );

  const filteredFeed = useMemo(
    () =>
      filterActivityFeedItems(feedItems, {
        nameQuery: feedNameQuery,
        rangePreset: feedRangePreset,
        customStart: feedCustomStart,
        customEnd: feedCustomEnd,
        typeFilter: feedTypeFilter,
        statusFilter: feedStatusFilter,
      }),
    [
      feedItems,
      feedNameQuery,
      feedRangePreset,
      feedCustomStart,
      feedCustomEnd,
      feedTypeFilter,
      feedStatusFilter,
    ]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-gray-500">加载中…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-4">
        <p className="text-gray-600">未登录</p>
        <Link href="/login" className="text-blue-600 hover:underline">去登录</Link>
      </div>
    );
  }

  if (!teacherAccessOk) {
    return (
      <div className="space-y-4 max-w-md">
        <p className="text-gray-900 font-medium">该账号没有教师权限</p>
        <p className="text-sm text-gray-600">
          如需使用教师端，请联系管理员将您的邮箱加入教师白名单；学生请使用「我是学生」登录入口。
        </p>
        <div className="flex flex-col gap-2">
          <Link href="/student" className="text-teal-700 hover:underline font-medium">
            前往学生端
          </Link>
          <Link href="/login" className="text-teal-600 hover:underline text-sm">
            重新登录
          </Link>
          <Link href="/" className="text-gray-500 hover:underline text-sm">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>周报</CardTitle>
          <CardDescription>选择日期范围并导出图片</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">开始日期</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="max-w-[160px]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">结束日期</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="max-w-[160px]"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => applyPreset("本周")}>本周</Button>
              <Button variant="secondary" onClick={() => applyPreset("本月")}>本月</Button>
              <Button variant="secondary" onClick={() => applyPreset("本学期")}>本学期</Button>
            </div>
          </div>
          <div
            ref={setReportRef}
            className="bg-[var(--card)] p-6 rounded-2xl border border-[var(--card-border)] shadow-sm"
          >
            <h3 className="text-lg font-medium text-gray-900 mb-1">周报</h3>
            <p className="text-sm text-gray-500 mb-4">{startDate} ～ {endDate}</p>
            <Table>
              <TableHeader>
                <TableHead>姓名</TableHead>
                <TableHead>累计小时</TableHead>
                <TableHead>累计单词</TableHead>
                <TableHead>本周新单词</TableHead>
                <TableHead>本周日记天数</TableHead>
                <TableHead>口语课参与度</TableHead>
                <TableHead>完成情况汇总</TableHead>
              </TableHeader>
              <TableBody>
                {report.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.display_name}</TableCell>
                    <TableCell>{formatTimeMinutes(r.cumulativeMinutes)}</TableCell>
                    <TableCell>{r.cumulativeWords}</TableCell>
                    <TableCell>{r.sumNewWords}</TableCell>
                    <TableCell>{r.diaryDaysInWeek}</TableCell>
                    <TableCell>{r.speakingScore}</TableCell>
                    <TableCell className="text-sm text-gray-700 max-w-[220px]">{r.completionSummary}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-gray-400 mt-4">谢村咏梅英文剧社 · 内部使用</p>
          </div>
          <Button onClick={handleExportPng} disabled={exporting}>
            {exporting ? "导出中…" : "导出周报图片（PNG）"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-4">
          <Tabs
            tabs={["学生列表", "作业动态", "口语课"]}
            activeTab={teacherLowerTab}
            onTabChange={setTeacherLowerTab}
          />
          {teacherLowerTab === "学生列表" ? (
            <>
              <CardTitle>学生列表</CardTitle>
              <CardDescription>管理学生并查看详情</CardDescription>
            </>
          ) : teacherLowerTab === "作业动态" ? (
            <>
              <CardTitle>作业动态</CardTitle>
              <CardDescription>最近上传的阅读与日记，无需逐个点进学生页</CardDescription>
            </>
          ) : (
            <>
              <CardTitle>口语课</CardTitle>
              <CardDescription>为开启口语课的学生录入当日课程参与度（0=缺勤，1–5=出勤）</CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {teacherLowerTab === "学生列表" ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">搜索</label>
                <Input
                  type="text"
                  placeholder="按姓名或邮箱搜索"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="max-w-xs"
                />
              </div>
              <Table>
                <TableHeader>
                  <TableHead>姓名</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>口语课</TableHead>
                  <TableHead>操作</TableHead>
                </TableHeader>
                <TableBody>
                  {filteredStudents.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link href={`/teacher/student/${s.id}`} className="text-blue-600 hover:underline font-medium">
                          {formatStudentDisplayName(s)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-gray-500">{s.email}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={!!s.is_speaking_student}
                          onClick={() => handleToggleSpeaking(s.id, s.is_speaking_student)}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 ${
                            s.is_speaking_student ? "bg-[var(--primary)]" : "bg-gray-200"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                              s.is_speaking_student ? "translate-x-5" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </TableCell>
                      <TableCell>
                        <Link href={`/teacher/student/${s.id}`} className="text-blue-600 hover:underline text-sm">
                          查看
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          ) : teacherLowerTab === "作业动态" ? (
            <>
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">学生</label>
                    <Input
                      type="text"
                      placeholder="模糊搜索姓名"
                      value={feedNameQuery}
                      onChange={(e) => setFeedNameQuery(e.target.value)}
                      className="w-[200px]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">时间</label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={feedRangePreset === "all" ? "default" : "secondary"}
                    size="sm"
                    onClick={() => setFeedRangePreset("all")}
                  >
                    全部
                  </Button>
                  <Button
                    type="button"
                    variant={feedRangePreset === "today" ? "default" : "secondary"}
                    size="sm"
                    onClick={() => setFeedRangePreset("today")}
                  >
                    今天
                  </Button>
                  <Button
                    type="button"
                    variant={feedRangePreset === "week" ? "default" : "secondary"}
                    size="sm"
                    onClick={() => setFeedRangePreset("week")}
                  >
                    本周
                  </Button>
                      <Button
                        type="button"
                        variant={feedRangePreset === "month" ? "default" : "secondary"}
                        size="sm"
                        onClick={() => setFeedRangePreset("month")}
                      >
                        本月
                      </Button>
                      <Button
                        type="button"
                        variant={feedRangePreset === "custom" ? "default" : "secondary"}
                        size="sm"
                        onClick={() => setFeedRangePreset("custom")}
                      >
                        自定义
                      </Button>
                    </div>
                  </div>
                </div>
                {feedRangePreset === "custom" && (
                  <div className="flex flex-wrap gap-4 items-end">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">开始</label>
                      <Input
                        type="date"
                        value={feedCustomStart}
                        onChange={(e) => setFeedCustomStart(e.target.value)}
                        className="max-w-[160px]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">结束</label>
                      <Input
                        type="date"
                        value={feedCustomEnd}
                        onChange={(e) => setFeedCustomEnd(e.target.value)}
                        className="max-w-[160px]"
                      />
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-4 items-end">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">作业类型</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { v: "all", label: "全部" },
                        { v: "reading", label: "阅读" },
                        { v: "diary", label: "日记" },
                      ].map(({ v, label }) => (
                        <Button
                          key={v}
                          type="button"
                          variant={feedTypeFilter === v ? "default" : "secondary"}
                          size="sm"
                          onClick={() => setFeedTypeFilter(v)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { v: "all", label: "全部" },
                        { v: "diary_ungraded", label: "未批改" },
                        { v: "diary_graded", label: "已批改" },
                        { v: "reading_needs_review", label: "需核对" },
                      ].map(({ v, label }) => (
                        <Button
                          key={v}
                          type="button"
                          variant={feedStatusFilter === v ? "default" : "secondary"}
                          size="sm"
                          onClick={() => setFeedStatusFilter(v)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {filteredFeed.length === 0 ? (
                <p className="text-sm text-gray-500 py-6">当前筛选下暂无动态</p>
              ) : (
                <ul className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2">
                  {filteredFeed.map((item) => {
                    const readingRaw =
                      item.type === "reading" ? feedReadings.find((r) => r.id === item.id) : null;
                    const diaryRaw =
                      item.type === "diary" ? feedDiaries.find((r) => r.id === item.id) : null;
                    return (
                    <li
                      key={`${item.type}-${item.id}`}
                      className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          href={`/teacher/student/${item.student_id}`}
                          className="font-semibold text-blue-600 hover:underline"
                        >
                          {item.student_name}
                        </Link>
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            item.type === "reading"
                              ? "bg-violet-100 text-violet-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {item.type === "reading" ? "阅读" : "日记"}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">上传时间：{formatFeedTime(item.created_at)}</p>
                      {item.image_url ? (
                        <a href={item.image_url} target="_blank" rel="noopener noreferrer" className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.image_url}
                            alt=""
                            className="w-full max-h-[min(420px,70vh)] object-contain rounded-xl bg-gray-50 border border-gray-100"
                          />
                        </a>
                      ) : (
                        <div className="aspect-video rounded-xl bg-gray-100 flex items-center justify-center text-sm text-gray-400">
                          无图片
                        </div>
                      )}
                      {item.type === "reading" ? (
                        <>
                          <div className="text-sm text-gray-700 space-y-1">
                            <p>
                              累计单词：<span className="font-medium">{item.total_words ?? "—"}</span>
                            </p>
                            <p>
                              本周新增：<span className="font-medium">{item.weekly_new_words ?? "—"}</span>
                            </p>
                            {(item.extraction_status === "needs_review" || item.extraction_status === "failed") && (
                              <p className="text-amber-700 text-xs">识别需核对（{item.extraction_status}）</p>
                            )}
                          </div>
                          {readingRaw ? (
                            <FeedReadingWeekCalendar
                              record={readingRaw}
                              onDayRequestToggle={(dateStr, currentlyRead) => {
                                setReadingDayConfirm({
                                  recordId: item.id,
                                  dateStr,
                                  currentlyRead,
                                });
                              }}
                            />
                          ) : null}
                        </>
                      ) : (
                        <>
                          <div className="text-sm text-gray-700 space-y-1">
                            <p>
                              统计用完成日（可多日）：
                              <span className="font-medium">
                                {item.diaryDaysDisplay || "—"}
                              </span>
                              {(item.diaryDaysForFilter || []).length > 0 ? (
                                <span className="text-xs text-teal-600 ml-1">（已标注 diary_days）</span>
                              ) : (
                                <span className="text-xs text-gray-500 ml-1">（未标注则不计入统计）</span>
                              )}
                            </p>
                            <p>
                              批改状态：
                              <span className="font-medium">{item.diary_graded ? "已批改" : "未批改"}</span>
                            </p>
                          </div>
                          {diaryRaw ? (
                            <DiaryWeekDaysPicker
                              diaryRecord={diaryRaw}
                              saving={savingDiaryDateId === item.id}
                              onChangeDiaryDays={(days) => handleSaveDiaryDaysInFeed(item.id, days)}
                            />
                          ) : null}
                        </>
                      )}
                    </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4 sm:items-end">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">课程日期</label>
                  <Input
                    type="date"
                    value={speakingCourseDate}
                    onChange={(e) => setSpeakingCourseDate(e.target.value.slice(0, 10))}
                    className="max-w-[180px]"
                  />
                </div>
                <p className="text-sm text-gray-500 max-w-xl pb-1">
                  所选日期即本节课日期；保存后写入该日记录。可改选更早日期补录历史课程。
                </p>
              </div>
              {speakingStudentsList.length === 0 ? (
                <p className="text-gray-500 py-8">
                  暂无开启口语课的学生。请在「学生列表」中打开对应学生的「口语课」开关。
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableHead>学生姓名</TableHead>
                    <TableHead>参与度分数（0–5）</TableHead>
                    <TableHead>出勤状态</TableHead>
                    <TableHead>历史出勤率</TableHead>
                    <TableHead>操作</TableHead>
                  </TableHeader>
                  <TableBody>
                    {speakingStudentsList.map((s) => {
                      const name = formatStudentDisplayName(s);
                      const saved = allSpeakingScores.find(
                        (r) => r.student_id === s.id && speakingScoreClassDate(r) === speakingCourseDate
                      );
                      const draftVal = speakingDraft[s.id] ?? "";
                      const savedScore = saved != null ? saved.score : null;
                      const rate = speakingHistoricalAttendancePercent(allSpeakingScores, s.id);
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{name}</TableCell>
                          <TableCell>
                            <select
                              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] min-w-[140px]"
                              value={draftVal}
                              onChange={(e) =>
                                setSpeakingDraft((prev) => ({ ...prev, [s.id]: e.target.value }))
                              }
                              disabled={savingSpeakingId === s.id}
                            >
                              <option value="">未录入</option>
                              <option value="0">0（缺勤）</option>
                              <option value="1">1</option>
                              <option value="2">2</option>
                              <option value="3">3</option>
                              <option value="4">4</option>
                              <option value="5">5</option>
                            </select>
                          </TableCell>
                          <TableCell className="text-sm text-gray-700">
                            {speakingAttendanceStatusLabel(draftVal, savedScore)}
                          </TableCell>
                          <TableCell className="text-sm text-gray-700">
                            {rate == null ? "—" : `${rate}%`}
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              className="px-3 py-1.5 text-xs rounded-xl"
                              disabled={savingSpeakingId === s.id}
                              onClick={() => handleSaveSpeakingScore(s.id)}
                            >
                              {savingSpeakingId === s.id ? "保存中…" : "保存"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {readingDayConfirm && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reading-day-confirm-title"
          onClick={() => {
            if (!persistingReadingDay) setReadingDayConfirm(null);
          }}
        >
          <div
            className="relative z-[2001] w-full max-w-md rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute top-3 right-3 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
              aria-label="关闭"
              disabled={persistingReadingDay}
              onClick={() => setReadingDayConfirm(null)}
            >
              ×
            </button>
            <h2 id="reading-day-confirm-title" className="text-lg font-semibold text-gray-900 pr-10">
              确认修改
            </h2>
            <p className="mt-3 text-sm text-gray-600 leading-relaxed">
              {readingDayConfirm.currentlyRead
                ? `确认将 ${readingDayConfirm.dateStr} 改为「未读」吗？`
                : `确认将 ${readingDayConfirm.dateStr} 改为「已读」吗？`}
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                disabled={persistingReadingDay}
                onClick={() => setReadingDayConfirm(null)}
              >
                取消
              </Button>
              <Button type="button" disabled={persistingReadingDay} onClick={handleConfirmReadingDay}>
                {persistingReadingDay ? "保存中…" : "确认修改"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
