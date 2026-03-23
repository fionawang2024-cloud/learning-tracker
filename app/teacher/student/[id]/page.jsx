"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { fetchTeacherAuthorization } from "@/lib/teacherAuthClient";
import { hasDevTeacherAccess } from "@/lib/devMode";
import {
  listStudents,
  listDiaryByStudent,
  listReadingByStudent,
  listSpeakingByStudent,
  updateDiaryRecord,
  updateReadingRecord,
  createSpeakingScore,
  getLatestReadingRecordBefore,
  updateStudentSpeakingFlag,
} from "@/lib/db";
import { getPublicUrl, getSignedUrl } from "@/lib/storage";
import { minutesToHoursMinutes, hoursMinutesToMinutes } from "@/lib/timeFormat";
import { computeWeeklyNewWordsFromReadings } from "@/lib/weeklyReadingWords";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { formatDiaryDaysDisplay } from "@/lib/diaryDate";
import { formatStudentDisplayName } from "@/lib/studentDisplayName";
import { DiaryWeekDaysPicker } from "@/components/teacher/DiaryWeekDaysPicker";
import {
  normalizeReadingRecordForCalendar,
  isReadingDaysEmpty,
  readingDaysDescendingFromDaily,
  getCalendarCompletionSource,
  getEffectiveCompletedDateSet,
  isReadingDayCompletedFromRecord,
  getLatestOcrDateStr,
  getDefaultWeekAnchorDateStr,
  getWeekDaysForRecord,
  normalizeRowDateString,
  extractReadingDaysFromDailyRecords,
  buildToggleReadingDaysUpdate,
} from "@/lib/teacherReadingCalendar";

const FALLBACK_MSG = "无法加载图片预览，请尝试新窗口查看原图";

/**
 * Teacher-side image: use direct public URL first; on load error try signed URL (private bucket).
 * No fetch(blob) — only <img src="url">. On both fail show friendly fallback and "新窗口查看原图" link.
 */
function TeacherStorageImage({ bucket, path, alt, className, showNewWindowLink = false }) {
  const [resolvedUrl, setResolvedUrl] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [tryingSigned, setTryingSigned] = useState(false);

  const displayUrl = resolvedUrl ?? (path ? getPublicUrl(bucket, path) : null);
  const newWindowUrl = resolvedUrl ?? (path ? getPublicUrl(bucket, path) : null);

  const handleError = useCallback(() => {
    if (!path) {
      setLoadError(true);
      return;
    }
    if (tryingSigned) {
      setLoadError(true);
      return;
    }
    setTryingSigned(true);
    getSignedUrl(bucket, path)
      .then((url) => {
        if (url) setResolvedUrl(url);
        else setLoadError(true);
      })
      .catch(() => setLoadError(true));
  }, [bucket, path, tryingSigned]);

  if (!path) {
    return <p className="text-sm text-gray-500 py-4">暂无图片</p>;
  }
  if (loadError) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-amber-700 py-4">{FALLBACK_MSG}</p>
        <a
          href={newWindowUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-teal-600 hover:text-teal-700 underline"
          onClick={(e) => e.stopPropagation()}
        >
          新窗口查看原图
        </a>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <img
        src={displayUrl}
        alt={alt}
        className={className}
        onError={handleError}
      />
      {showNewWindowLink && newWindowUrl && (
        <a
          href={newWindowUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-teal-600 hover:text-teal-700 underline"
          onClick={(e) => e.stopPropagation()}
        >
          新窗口查看原图
        </a>
      )}
    </div>
  );
}

/** 教师端列表内：阅读 / 日记共用占位与尺寸（与阅读记录一致：max-w-[480px]） */
function TeacherRecordInlinePreview({ bucket, path, alt, onExpand }) {
  return (
    <div className="w-full max-w-[480px] shrink-0">
      <button
        type="button"
        className="group block w-full max-w-[480px] focus:outline-none text-left"
        onClick={onExpand}
      >
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm w-full max-w-[480px]">
          <TeacherStorageImage
            bucket={bucket}
            path={path}
            alt={alt}
            className="w-full max-w-[480px] h-auto object-contain bg-white"
            showNewWindowLink
          />
        </div>
        <span className="mt-1 text-xs text-gray-500 group-hover:text-teal-600">点击放大查看</span>
      </button>
    </div>
  );
}

const TABS_ZH = ["英语日记", "阅读记录", "口语课"];

export default function TeacherStudentPage() {
  const params = useParams();
  const id = params?.id;
  const [user, setUser] = useState(null);
  const [student, setStudent] = useState(null);
  const [tab, setTab] = useState("英语日记");
  const [diaryRecords, setDiaryRecords] = useState([]);
  const [readingRecords, setReadingRecords] = useState([]);
  const [speakingScores, setSpeakingScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [teacherAccessOk, setTeacherAccessOk] = useState(false);
  const [feedbackEdits, setFeedbackEdits] = useState({});
  const [readingEdits, setReadingEdits] = useState({});
  const [savingDiary, setSavingDiary] = useState(null);
  const [savingDiaryDateId, setSavingDiaryDateId] = useState(null);
  const [savingReading, setSavingReading] = useState(null);
  const [newScore, setNewScore] = useState("");
  const [savingScore, setSavingScore] = useState(false);
  const [readingImageModal, setReadingImageModal] = useState(null);
  const [diaryImageModal, setDiaryImageModal] = useState(null);
  /** Per reading record: week offset from OCR-default week (0 = 识别周). */
  const [readingCalendarWeekOffset, setReadingCalendarWeekOffset] = useState({});

  useEffect(() => {
    setReadingCalendarWeekOffset({});
  }, [id]);

  useEffect(() => {
    setReadingCalendarWeekOffset((prev) => {
      const ids = new Set(readingRecords.map((r) => r.id));
      const next = {};
      for (const rid of ids) {
        next[rid] = prev[rid] ?? 0;
      }
      return next;
    });
  }, [readingRecords]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      console.log("[teacher-student] initial load: getUser");
      const { data: { user: u } } = await supabase.auth.getUser();
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
      console.log("[teacher-student] initial load: listStudents");
      const students = await listStudents();
      const s = students.find((x) => x.id === id);
      if (!s) {
        setLoading(false);
        return;
      }
      setStudent(s);
      console.log("[teacher-student] initial load: listDiaryByStudent/listReadingByStudent/listSpeakingByStudent", { studentId: id });
      const [diary, readingRaw, speaking] = await Promise.all([
        listDiaryByStudent(id),
        listReadingByStudent(id),
        listSpeakingByStudent(id),
      ]);
      const reading = (readingRaw || []).map(normalizeReadingRecordForCalendar);
      for (const raw of readingRaw || []) {
        const normalized = normalizeReadingRecordForCalendar(raw);
        const effective = [...getEffectiveCompletedDateSet(normalized)].sort();
        console.log("[teacher-student] loaded reading record fields from Supabase", {
          id: raw.id,
          reading_days: raw.reading_days ?? null,
          daily_records_json:
            Array.isArray(raw.daily_records_json)
              ? { type: "array", length: raw.daily_records_json.length }
              : raw.daily_records_json == null
                ? null
                : { type: typeof raw.daily_records_json },
          effective_calendar_dates_for_highlight: effective,
        });
      }
      setDiaryRecords(diary);
      let updatedReading = reading;
      // 自动：reading_days 为空 / null 时，用 OCR daily_records 日期写入 Supabase（教师已编辑则不覆盖）
      try {
        const toAutoFill = reading.filter(
          (r) =>
            isReadingDaysEmpty(r.reading_days) &&
            Array.isArray(r.daily_records_json) &&
            r.daily_records_json.length > 0
        );
        if (toAutoFill.length > 0) {
          updatedReading = [...reading];
          await Promise.all(
            toAutoFill.map(async (r) => {
              const days = readingDaysDescendingFromDaily(r);
              if (!days.length) return;
              try {
                console.log("[teacher-student] auto-fill reading_days from OCR (persist)", {
                  recordId: r.id,
                  reading_days: days,
                });
                await updateReadingRecord(r.id, { reading_days: days });
                const idx = updatedReading.findIndex((x) => x.id === r.id);
                if (idx >= 0) {
                  updatedReading[idx] = { ...updatedReading[idx], reading_days: days };
                }
              } catch (e) {
                console.error("[teacher-student] auto-fill reading_days failed", {
                  recordId: r.id,
                  error: e,
                  message: e?.message,
                  details: e?.details,
                  hint: e?.hint,
                });
              }
            })
          );
        }
      } catch (e) {
        console.error("[teacher-student] auto-fill reading_days wrapper failed", e);
      }
      setReadingRecords(updatedReading);
      for (const r of updatedReading) {
        const initial = reading.find((x) => x.id === r.id);
        const anchor = getDefaultWeekAnchorDateStr(r);
        const weekDays = getWeekDaysForRecord(r, 0);
        const rangeLabel =
          weekDays.length >= 7
            ? `${weekDays[0].dateStr} ～ ${weekDays[6].dateStr}`
            : "—";
        const ocrDates = extractReadingDaysFromDailyRecords(r);
        const effective = [...getEffectiveCompletedDateSet(r)].sort();
        console.log("[teacher-student] reading calendar sync", {
          recordId: r.id,
          reading_days_from_db_before_autofill: initial?.reading_days ?? null,
          reading_days_after_autofill: r.reading_days ?? null,
          ocr_daily_dates: ocrDates,
          effective_calendar_dates_for_render: effective,
          completion_source: getCalendarCompletionSource(r),
          latest_ocr_date: getLatestOcrDateStr(r) ?? "(none)",
          week_anchor_used: anchor,
          displayed_week_range: rangeLabel,
          daily_records_json_rows: Array.isArray(r.daily_records_json)
            ? r.daily_records_json.length
            : 0,
        });
      }
      setSpeakingScores(speaking);
      const feed = {};
      diary.forEach((r) => (feed[r.id] = r.teacher_feedback ?? ""));
      setFeedbackEdits(feed);
      const red = {};
      updatedReading.forEach((r) => {
        const { hours, minutes } = minutesToHoursMinutes(r.total_time_minutes ?? 0);
        red[r.id] = {
          total_words: r.total_words,
          total_time_minutes: r.total_time_minutes,
          readingHours: String(hours),
          readingMinutes: String(minutes),
        };
      });
      setReadingEdits(red);
      setLoading(false);
    })();
  }, [id]);

  async function handleToggleSpeaking() {
    if (!student) return;
    try {
      const updated = await updateStudentSpeakingFlag(student.id, !student.is_speaking_student);
      setStudent(updated);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleSaveFeedback(recordId) {
    const text = feedbackEdits[recordId];
    if (text === undefined) return;
    setSavingDiary(recordId);
    try {
      await updateDiaryRecord(recordId, { teacher_feedback: text });
      setDiaryRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, teacher_feedback: text } : r)));
    } catch (e) {
      console.error(e);
    } finally {
      setSavingDiary(null);
    }
  }

  async function handleSaveDiaryDays(diaryId, days) {
    setSavingDiaryDateId(diaryId);
    try {
      const updated = await updateDiaryRecord(diaryId, { diary_days: days, diary_date: null });
      setDiaryRecords((prev) => prev.map((r) => (r.id === diaryId ? { ...r, ...updated } : r)));
    } catch (e) {
      console.error(e);
      alert("保存 diary_days 失败，请稍后重试或确认已执行数据库迁移。");
    } finally {
      setSavingDiaryDateId(null);
    }
  }

  async function handleSaveReading(recordId) {
    const edit = readingEdits[recordId];
    if (!edit) return;
    const totalWords = parseInt(edit.total_words, 10);
    const totalTime =
      edit.readingHours != null && edit.readingMinutes != null
        ? hoursMinutesToMinutes(edit.readingHours, edit.readingMinutes)
        : (edit.total_time_minutes ?? 0);
    if (isNaN(totalWords)) return;
    const rec = readingRecords.find((r) => r.id === recordId);
    if (!rec) return;
    setSavingReading(recordId);
    try {
      console.log("[teacher-student] handleSaveReading start", { recordId, totalWords, totalTime });
      const prev = await getLatestReadingRecordBefore(student.id, rec.created_at);
      const prevWords = prev?.total_words ?? 0;
      const weeklyNewWords = Math.max(0, totalWords - prevWords);
      const updates = {
        total_words: totalWords,
        total_time_minutes: totalTime,
        weekly_new_words: weeklyNewWords,
        extraction_status: "success",
      };
      await updateReadingRecord(recordId, updates);
      setReadingRecords((prev) =>
        prev.map((r) =>
          r.id === recordId
            ? { ...r, total_words: totalWords, total_time_minutes: totalTime, weekly_new_words: weeklyNewWords, extraction_status: "success" }
            : r
        )
      );
      const { hours, minutes } = minutesToHoursMinutes(totalTime);
      setReadingEdits((prev) => ({
        ...prev,
        [recordId]: {
          total_words: totalWords,
          total_time_minutes: totalTime,
          readingHours: String(hours),
          readingMinutes: String(minutes),
        },
      }));
    } catch (e) {
      console.error("[teacher-student] handleSaveReading failed", e);
      console.error("[teacher-student] handleSaveReading details", e?.message, e?.details, e?.hint);
    } finally {
      setSavingReading(null);
    }
  }

  async function handleToggleReadingDay(recordId, dateStr) {
    const selectedReadingRecord = readingRecords.find((r) => r.id === recordId);
    const norm = selectedReadingRecord ? normalizeReadingRecordForCalendar(selectedReadingRecord) : null;
    const built = buildToggleReadingDaysUpdate(norm, dateStr);

    if (!built || !selectedReadingRecord) {
      console.error("[handleToggleReadingDay] missing data", {
        recordId,
        studentId: student?.id,
      });
      alert("无法修改该日期，请先确认阅读记录已加载完成");
      return;
    }

    const payload = { reading_days: built.updatedDays };
    console.log("[handleToggleReadingDay] payload:", payload);

    try {
      await updateReadingRecord(recordId, payload);
      setReadingRecords((prev) =>
        prev.map((r) =>
          r.id === recordId ? { ...r, reading_days: built.updatedDays } : r
        )
      );
    } catch (e) {
      console.error("Supabase update error:", e);
      console.error("Supabase details:", e?.message, e?.details, e?.hint);
      console.error("[handleToggleReadingDay] selected date:", built.targetDate);
      console.error("[handleToggleReadingDay] current student id:", student?.id);
      console.error("[handleToggleReadingDay] current reading record id:", selectedReadingRecord?.id ?? null);
      alert("无法修改该日期，请稍后重试或联系管理员。");
    }
  }

  function setReadingEdit(recordId, field, value) {
    setReadingEdits((prev) => ({
      ...prev,
      [recordId]: { ...(prev[recordId] || {}), [field]: value },
    }));
  }

  async function handleAddScore() {
    const score = parseInt(newScore, 10);
    if (isNaN(score) || score < 1 || score > 5 || !student?.id) return;
    setSavingScore(true);
    try {
      const created = await createSpeakingScore(student.id, score);
      setSpeakingScores((prev) => [created, ...prev]);
      setNewScore("");
    } catch (e) {
      console.error(e);
    } finally {
      setSavingScore(false);
    }
  }

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
        <Link href="/login" className="text-teal-600 hover:underline">
          去登录
        </Link>
      </div>
    );
  }

  if (!teacherAccessOk) {
    return (
      <div className="space-y-4 max-w-md">
        <p className="text-gray-900 font-medium">该账号没有教师权限</p>
        <p className="text-sm text-gray-600">
          无法查看学生详情。请使用已授权的教师账号登录，或使用学生端入口。
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

  if (!student) {
    return (
      <div className="space-y-4">
        <p className="text-gray-600">未找到该学生</p>
        <Link href="/teacher" className="text-blue-600 hover:underline">← 教师端</Link>
      </div>
    );
  }

  const readingModalIndex =
    readingImageModal && typeof readingImageModal.index === "number"
      ? Math.max(0, Math.min(readingImageModal.index, Math.max(0, readingRecords.length - 1)))
      : 0;
  const readingModalRecord =
    readingRecords.length > 0 && readingModalIndex >= 0 ? readingRecords[readingModalIndex] : null;

  const diaryModalIndex =
    diaryImageModal && typeof diaryImageModal.index === "number"
      ? Math.max(0, Math.min(diaryImageModal.index, Math.max(0, diaryRecords.length - 1)))
      : 0;
  const diaryModalRecord =
    diaryRecords.length > 0 && diaryModalIndex >= 0 ? diaryRecords[diaryModalIndex] : null;

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>{formatStudentDisplayName(student)}</CardTitle>
              <CardDescription>{student.email}</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">口语课</span>
              <button
                type="button"
                role="switch"
                aria-checked={!!student.is_speaking_student}
                onClick={handleToggleSpeaking}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 ${
                  student.is_speaking_student ? "bg-[var(--primary)]" : "bg-gray-200"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                    student.is_speaking_student ? "translate-x-5" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Tabs tabs={TABS_ZH} activeTab={tab} onTabChange={setTab} />

      {tab === "英语日记" && (
        <Card>
          <CardHeader>
            <CardTitle>英语日记</CardTitle>
            <CardDescription>查看日记并填写教师反馈</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {diaryRecords.length === 0 ? (
              <p className="text-gray-500">暂无日记记录</p>
            ) : (
              diaryRecords.map((r) => (
                <div key={r.id} className="pb-6 border-b border-gray-100 last:border-0 last:pb-0">
                  <div className="text-sm text-gray-500 mb-2 space-y-0.5">
                    <p>上传日：{r.upload_date || "—"}</p>
                    <p>
                      统计用完成日（可多日）：
                      <span className="font-medium text-gray-800">{formatDiaryDaysDisplay(r)}</span>
                      <span className="text-gray-400 text-xs ml-1">（以 diary_days 为准，未标注不计入）</span>
                    </p>
                  </div>
                  <div className="flex flex-col md:flex-row items-start gap-6 mb-4">
                    <TeacherRecordInlinePreview
                      bucket="diary-images"
                      path={r.image_path}
                      alt="日记"
                      onExpand={() =>
                        setDiaryImageModal({
                          index: diaryRecords.findIndex((x) => x.id === r.id),
                        })
                      }
                    />
                    <div className="flex-1 space-y-4">
                      <DiaryWeekDaysPicker
                        diaryRecord={r}
                        saving={savingDiaryDateId === r.id}
                        onChangeDiaryDays={(days) => handleSaveDiaryDays(r.id, days)}
                      />
                      <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700">教师反馈</label>
                        <Textarea
                          value={feedbackEdits[r.id] ?? ""}
                          onChange={(e) =>
                            setFeedbackEdits((prev) => ({ ...prev, [r.id]: e.target.value }))
                          }
                          rows={2}
                        />
                        <Button
                          onClick={() => handleSaveFeedback(r.id)}
                          disabled={savingDiary === r.id}
                          className="mt-2"
                        >
                          {savingDiary === r.id ? "保存中…" : "保存反馈"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {tab === "阅读记录" && (
        <Card>
          <CardHeader>
            <CardTitle>阅读记录</CardTitle>
            <CardDescription>查看并编辑阅读数据</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {readingRecords.length === 0 ? (
              <p className="text-gray-500">暂无阅读记录</p>
            ) : (
              readingRecords.map((r) => (
                <div key={r.id} className="pb-6 border-b border-gray-100 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <p className="text-sm text-gray-500">
                      {r.created_at ? new Date(r.created_at).toLocaleString("zh-CN") : "—"}
                    </p>
                    {(() => {
                      const status = r?.extraction_status || "needs_review";
                      if (status === "success") {
                        return <Badge variant="success">识别成功</Badge>;
                      }
                      if (status === "failed") {
                        return <Badge variant="warning">识别失败</Badge>;
                      }
                      return <Badge variant="warning">需人工核对</Badge>;
                    })()}
                  </div>
                  <div className="flex flex-col md:flex-row items-start gap-6 mb-4">
                    <TeacherRecordInlinePreview
                      bucket="reading-images"
                      path={r.image_path}
                      alt="阅读"
                      onExpand={() =>
                        setReadingImageModal({
                          index: readingRecords.findIndex((x) => x.id === r.id),
                        })
                      }
                    />
                    <div className="flex-1 space-y-3">
                      {r?.total_reading_days != null && (
                        <p className="text-sm text-gray-600">阅读天数：{r.total_reading_days}</p>
                      )}
                      <div className="flex gap-4 flex-wrap">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            累计单词数
                          </label>
                          <Input
                            type="number"
                            min={0}
                            value={readingEdits[r.id]?.total_words ?? r.total_words ?? ""}
                            onChange={(e) => setReadingEdit(r.id, "total_words", e.target.value)}
                            className="w-24"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            累计时间（时:分）
                          </label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              value={readingEdits[r.id]?.readingHours ?? ""}
                              onChange={(e) => {
                                const h = e.target.value;
                                const m = readingEdits[r.id]?.readingMinutes ?? "0";
                                const total = hoursMinutesToMinutes(h, m);
                                setReadingEdits((prev) => ({
                                  ...prev,
                                  [r.id]: {
                                    ...(prev[r.id] || {}),
                                    readingHours: h,
                                    readingMinutes: m,
                                    total_time_minutes: total,
                                  },
                                }));
                              }}
                              className="w-16 min-w-16"
                            />
                            <span className="text-gray-500 text-sm shrink-0">时</span>
                            <Input
                              type="number"
                              min={0}
                              max={59}
                              value={readingEdits[r.id]?.readingMinutes ?? ""}
                              onChange={(e) => {
                                let mVal = e.target.value;
                                let h = readingEdits[r.id]?.readingHours ?? "0";
                                let mn = parseInt(mVal, 10);
                                if (!isNaN(mn) && mn >= 60) {
                                  h = String((parseInt(h, 10) || 0) + Math.floor(mn / 60));
                                  mn = mn % 60;
                                  mVal = String(mn);
                                }
                                const total = hoursMinutesToMinutes(h, mVal);
                                setReadingEdits((prev) => ({
                                  ...prev,
                                  [r.id]: {
                                    ...(prev[r.id] || {}),
                                    readingHours: h,
                                    readingMinutes: mVal,
                                    total_time_minutes: total,
                                  },
                                }));
                              }}
                              className="w-16 min-w-16"
                            />
                            <span className="text-gray-500 text-sm shrink-0">分</span>
                          </div>
                        </div>
                      </div>
                      <div className="mt-3">
                        {(() => {
                          const weekOffset = readingCalendarWeekOffset[r.id] ?? 0;
                          const weekDays = getWeekDaysForRecord(r, weekOffset);
                          const rangeLabel =
                            weekDays.length >= 7
                              ? `${weekDays[0].dateStr} ～ ${weekDays[6].dateStr}`
                              : "—";
                          const weekStart =
                            weekDays.length >= 7 ? weekDays[0].dateStr : null;
                          const weekEnd =
                            weekDays.length >= 7 ? weekDays[6].dateStr : null;
                          const weeklyWordsDisplayed =
                            weekStart && weekEnd
                              ? computeWeeklyNewWordsFromReadings(
                                  readingRecords,
                                  weekStart,
                                  weekEnd,
                                  {
                                    log: true,
                                    logCtx: {
                                      source: "teacher-student-reading-section",
                                      student_id: student?.id,
                                      reading_record_id: r.id,
                                      displayed_calendar_week: rangeLabel,
                                    },
                                  }
                                )
                              : 0;
                          const ocrLatest = getLatestOcrDateStr(r);
                          const showOcrDefaultHint = weekOffset === 0 && Boolean(ocrLatest);
                          return (
                            <>
                              <p className="text-sm text-gray-600 mb-2">
                                本周新增：单词 {weeklyWordsDisplayed}
                              </p>
                              <div className="space-y-2 mb-3">
                                <p className="text-xs text-gray-600">
                                  当前显示周：{rangeLabel}
                                </p>
                                {showOcrDefaultHint && (
                                  <p className="text-xs text-gray-500">默认依据 OCR 最新识别日期</p>
                                )}
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    className="px-3 py-1.5 text-xs rounded-xl"
                                    onClick={() =>
                                      setReadingCalendarWeekOffset((p) => ({
                                        ...p,
                                        [r.id]: (p[r.id] ?? 0) - 1,
                                      }))
                                    }
                                  >
                                    上一周
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    className="px-3 py-1.5 text-xs rounded-xl"
                                    onClick={() =>
                                      setReadingCalendarWeekOffset((p) => ({
                                        ...p,
                                        [r.id]: (p[r.id] ?? 0) + 1,
                                      }))
                                    }
                                  >
                                    下一周
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    className="px-3 py-1.5 text-xs rounded-xl"
                                    onClick={() =>
                                      setReadingCalendarWeekOffset((p) => ({
                                        ...p,
                                        [r.id]: 0,
                                      }))
                                    }
                                  >
                                    回到识别周
                                  </Button>
                                </div>
                              </div>
                              <p className="text-xs text-gray-500 mb-2">
                                本周阅读完成情况（点击可切换已读 / 未读）
                              </p>
                              <div className="grid grid-cols-7 gap-1 text-center text-xs">
                                {weekDays.map((d) => {
                                  const completed = isReadingDayCompletedFromRecord(r, d.dateStr);
                                  return (
                                    <button
                                      key={d.dateStr}
                                      type="button"
                                      className={`rounded-lg py-2 px-1 border text-xs ${
                                        completed
                                          ? "bg-teal-500 text-white border-teal-500"
                                          : "bg-white text-gray-700 border-gray-200"
                                      }`}
                                      onClick={() => handleToggleReadingDay(r.id, d.dateStr)}
                                    >
                                      <div>{d.labelDay}日</div>
                                      <div className="mt-0.5 text-[10px] opacity-80">{d.weekday}</div>
                                    </button>
                                  );
                                })}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      <Button
                        onClick={() => handleSaveReading(r.id)}
                        disabled={savingReading === r.id}
                      >
                        {savingReading === r.id ? "保存中…" : "保存"}
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {tab === "口语课" && (
        <Card>
          <CardHeader>
            <CardTitle>口语课</CardTitle>
            <CardDescription>添加口语分数并查看历史</CardDescription>
          </CardHeader>
          <CardContent>
            {student.is_speaking_student ? (
              <div className="space-y-6">
                <div className="flex gap-3 items-end flex-wrap">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">添加分数（1–5）</label>
                    <Input
                      type="number"
                      min={1}
                      max={5}
                      value={newScore}
                      onChange={(e) => setNewScore(e.target.value)}
                      className="w-20"
                    />
                  </div>
                  <Button onClick={handleAddScore} disabled={savingScore}>
                    {savingScore ? "保存中…" : "添加分数"}
                  </Button>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">历史记录</h3>
                  {speakingScores.length === 0 ? (
                    <p className="text-gray-500">暂无分数</p>
                  ) : (
                    <ul className="space-y-2">
                      {speakingScores.map((sc) => (
                        <li key={sc.id} className="py-2 border-b border-gray-100 last:border-0 text-sm">
                          分数 {sc.score} — {sc.created_at ? new Date(sc.created_at).toLocaleString("zh-CN") : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-gray-500">该学生未开启口语课。请在教师端学生列表中开启「口语课」开关。</p>
            )}
          </CardContent>
        </Card>
      )}

      {readingModalRecord && readingImageModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full mx-4 p-4 sm:p-6 relative z-[1001]">
            <button
              type="button"
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700 z-[1002]"
              onClick={() => setReadingImageModal(null)}
            >
              ✕
            </button>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-gray-600">
                  {readingModalRecord.created_at
                    ? new Date(readingModalRecord.created_at).toLocaleString("zh-CN")
                    : "—"}
                </p>
              </div>
              <div className="w-full flex items-center justify-center min-h-[200px]">
                {readingModalRecord.image_path ? (
                  <TeacherStorageImage
                    bucket="reading-images"
                    path={readingModalRecord.image_path}
                    alt="阅读原图预览"
                    className="max-h-[70vh] w-full object-contain rounded-xl border border-gray-100 bg-gray-50"
                    showNewWindowLink
                  />
                ) : (
                  <p className="text-sm text-gray-500 py-8">暂无图片</p>
                )}
              </div>
              {readingRecords.length > 1 && (
                <div className="flex items-center justify-between">
                  <Button
                    variant="secondary"
                    disabled={readingRecords.length === 0}
                    onClick={() =>
                      setReadingImageModal({
                        index:
                          (readingModalIndex - 1 + readingRecords.length) % readingRecords.length,
                      })
                    }
                  >
                    上一张
                  </Button>
                  <span className="text-xs text-gray-500">
                    {readingModalIndex + 1} / {readingRecords.length}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={readingRecords.length === 0}
                    onClick={() =>
                      setReadingImageModal({
                        index: (readingModalIndex + 1) % readingRecords.length,
                      })
                    }
                  >
                    下一张
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {diaryModalRecord && diaryImageModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full mx-4 p-4 sm:p-6 relative z-[1001]">
            <button
              type="button"
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700 z-[1002]"
              onClick={() => setDiaryImageModal(null)}
            >
              ✕
            </button>
            <div className="flex flex-col gap-4">
              <p className="text-sm text-gray-600">
                上传日：{diaryModalRecord.upload_date || "—"}
                <span className="mx-2">·</span>
                统计用完成日：{formatDiaryDaysDisplay(diaryModalRecord)}
              </p>
              <div className="w-full flex items-center justify-center min-h-[200px]">
                {diaryModalRecord.image_path ? (
                  <TeacherStorageImage
                    bucket="diary-images"
                    path={diaryModalRecord.image_path}
                    alt="日记原图预览"
                    className="max-h-[70vh] w-full object-contain rounded-xl border border-gray-100 bg-gray-50"
                    showNewWindowLink
                  />
                ) : (
                  <p className="text-sm text-gray-500 py-8">暂无图片</p>
                )}
              </div>
              {diaryRecords.length > 1 && (
                <div className="flex items-center justify-between">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setDiaryImageModal({
                        index: (diaryModalIndex - 1 + diaryRecords.length) % diaryRecords.length,
                      })
                    }
                  >
                    上一张
                  </Button>
                  <span className="text-xs text-gray-500">
                    {diaryModalIndex + 1} / {diaryRecords.length}
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setDiaryImageModal({
                        index: (diaryModalIndex + 1) % diaryRecords.length,
                      })
                    }
                  >
                    下一张
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
