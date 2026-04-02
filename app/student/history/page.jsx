"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { getOrCreateStudent, listDiaryByStudent, listReadingByStudent } from "@/lib/db";
import { normalizeReadingDaysArray } from "@/lib/readingRecordOcr";
import { getPublicUrl } from "@/lib/storage";
import { SEMESTER_START } from "@/lib/constants";
import { normalizeDiaryDaysArray } from "@/lib/diaryDate";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { STUDENT_RECORDS_UPDATED_EVENT } from "@/lib/studentRecordsEvents";
import { formatStudentDisplayName } from "@/lib/studentDisplayName";
import { studentNeedsDisplayNameSetup } from "@/lib/studentProfileSetup";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

function filterRecordsForSemesterWindow(diary, reading, semesterStart, todayKey) {
  const start = semesterStart;
  const end = todayKey;
  const diaryFiltered = diary.filter((r) =>
    normalizeDiaryDaysArray(r).some((d) => d >= start && d <= end)
  );
  const readingFiltered = reading.filter((r) => {
    const days = normalizeReadingDaysArray(r.reading_days);
    if (days.some((d) => d >= start && d <= end)) return true;
    const ca = r.created_at ? r.created_at.slice(0, 10) : null;
    return ca && ca >= start && ca <= end;
  });
  return { diaryFiltered, readingFiltered };
}

/** Local calendar YYYY-MM-DD (not UTC from toISOString). */
function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateKeyDisplay(dateKey) {
  if (!dateKey || dateKey.length < 10) return dateKey;
  const [y, m, day] = dateKey.split("-");
  return `${y}年${parseInt(m, 10)}月${parseInt(day, 10)}日`;
}

function getMonthStart(year, month) {
  return new Date(year, month - 1, 1);
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** Monday = 0. Returns 0-6. */
function getMondayBasedWeekday(date) {
  const d = date.getDay();
  return d === 0 ? 6 : d - 1;
}

export default function StudentHistoryPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [student, setStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [diaryRecords, setDiaryRecords] = useState([]);
  const [readingRecords, setReadingRecords] = useState([]);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth() + 1);
  const [monthFilter, setMonthFilter] = useState("");
  const [dayInput, setDayInput] = useState("");
  const [lightboxImage, setLightboxImage] = useState(null);
  const [selectedDayPanel, setSelectedDayPanel] = useState(null);

  const todayKey = useMemo(() => localDateKey(new Date()), []);

  const semesterStart = SEMESTER_START || "2026-02-01";
  const dayError = useMemo(() => {
    const raw = dayInput.trim();
    if (raw === "") return null;
    const dayNum = parseInt(raw, 10);
    if (Number.isNaN(dayNum) || dayNum < 1 || dayNum > 31) return "请输入 1–31 的数字";
    if (!monthFilter) return "请先选择月份";
    return null;
  }, [dayInput, monthFilter]);

  const diaryFiltered = useMemo(() => {
    let list = diaryRecords;
    if (monthFilter) {
      const [y, m] = monthFilter.split("-").map(Number);
      list = list.filter((r) =>
        normalizeDiaryDaysArray(r).some((d) => {
          const [ry, rm] = d.split("-").map(Number);
          return ry === y && rm === m;
        })
      );
    }
    const raw = dayInput.trim();
    if (raw !== "") {
      const dayNum = parseInt(raw, 10);
      if (Number.isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
        return [];
      }
      if (!monthFilter) {
        return [];
      }
      const targetDate = `${monthFilter}-${String(dayNum).padStart(2, "0")}`;
      list = list.filter((r) => normalizeDiaryDaysArray(r).includes(targetDate));
    }
    return list;
  }, [diaryRecords, monthFilter, dayInput]);

  /** Diary: diary_days（与教师端一致）；无标注则不计入。 */
  const diaryCompletedDates = useMemo(() => {
    const set = new Set();
    diaryRecords.forEach((r) => {
      normalizeDiaryDaysArray(r).forEach((d) => {
        if (d >= semesterStart && d <= todayKey) set.add(d);
      });
    });
    return set;
  }, [diaryRecords, semesterStart, todayKey]);

  /** Reading: reading_records.reading_days only (saved OCR/teacher edits — not upload_date). */
  const readingCompletedDates = useMemo(() => {
    const set = new Set();
    readingRecords.forEach((r) => {
      normalizeReadingDaysArray(r.reading_days).forEach((d) => {
        if (d >= semesterStart && d <= todayKey) set.add(d);
      });
    });
    return set;
  }, [readingRecords, semesterStart, todayKey]);

  const datesWithFeedback = useMemo(() => {
    const set = new Set();
    diaryRecords.forEach((r) => {
      if (!(r.teacher_feedback || "").trim()) return;
      normalizeDiaryDaysArray(r).forEach((d) => set.add(d));
    });
    return set;
  }, [diaryRecords]);

  const diaryByDate = useMemo(() => {
    const map = new Map();
    diaryRecords.forEach((r) => {
      normalizeDiaryDaysArray(r).forEach((eff) => {
        if (!map.has(eff)) map.set(eff, []);
        map.get(eff).push(r);
      });
    });
    return map;
  }, [diaryRecords]);

  /** Map date -> reading records that list that date in reading_days. */
  const readingByDate = useMemo(() => {
    const map = new Map();
    readingRecords.forEach((r) => {
      normalizeReadingDaysArray(r.reading_days).forEach((d) => {
        if (!map.has(d)) map.set(d, []);
        const list = map.get(d);
        if (!list.some((x) => x.id === r.id)) list.push(r);
      });
    });
    return map;
  }, [readingRecords]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user: u },
      } = await getSupabaseClient().auth.getUser();
      if (cancelled || !u) {
        setLoading(false);
        return;
      }
      setUser(u);
      const s = await getOrCreateStudent(u);
      if (cancelled || !s) {
        setLoading(false);
        return;
      }
      if (studentNeedsDisplayNameSetup(u.email, s.display_name)) {
        router.replace("/login/finish-student-profile");
        setLoading(false);
        return;
      }
      setStudent(s);
      const [diary, reading] = await Promise.all([
        listDiaryByStudent(s.id),
        listReadingByStudent(s.id),
      ]);
      if (!cancelled) {
        const { diaryFiltered, readingFiltered } = filterRecordsForSemesterWindow(
          diary,
          reading,
          semesterStart,
          todayKey
        );
        setDiaryRecords(diaryFiltered);
        setReadingRecords(readingFiltered);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [semesterStart, todayKey, router]);

  useEffect(() => {
    if (!student?.id) return undefined;
    function onRecordsUpdated() {
      (async () => {
        try {
          const [diary, reading] = await Promise.all([
            listDiaryByStudent(student.id),
            listReadingByStudent(student.id),
          ]);
          const { diaryFiltered, readingFiltered } = filterRecordsForSemesterWindow(
            diary,
            reading,
            semesterStart,
            todayKey
          );
          setDiaryRecords(diaryFiltered);
          setReadingRecords(readingFiltered);
        } catch (_) {}
      })();
    }
    window.addEventListener(STUDENT_RECORDS_UPDATED_EVENT, onRecordsUpdated);
    return () => window.removeEventListener(STUDENT_RECORDS_UPDATED_EVENT, onRecordsUpdated);
  }, [student?.id, semesterStart, todayKey]);

  const calendarGrid = useMemo(() => {
    const daysInMonth = getDaysInMonth(viewYear, viewMonth);
    const firstDay = getMonthStart(viewYear, viewMonth);
    const startOffset = getMondayBasedWeekday(firstDay);
    const rows = [];
    let day = 1;
    for (let row = 0; row < 6; row++) {
      const cells = [];
      for (let col = 0; col < 7; col++) {
        const cellIndex = row * 7 + col;
        if (cellIndex < startOffset || day > daysInMonth) {
          cells.push(
            <div key={`${row}-${col}`} className="min-h-[38px] sm:min-h-[44px] rounded-lg sm:rounded-xl bg-gray-50/50" />
          );
        } else {
          const dateKey = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const hasReading = readingCompletedDates.has(dateKey);
          const hasDiary = diaryCompletedDates.has(dateKey);
          const isCompleted = hasReading || hasDiary;
          const hasFeedback = datesWithFeedback.has(dateKey);
          const isToday = dateKey === todayKey;
          let cellClass =
            "min-h-[38px] sm:min-h-[44px] rounded-lg sm:rounded-xl border-2 text-xs sm:text-sm font-medium transition flex flex-col items-center justify-center gap-0.5 px-0.5 ";
          if (!isCompleted) {
            cellClass += "border-transparent bg-gray-50/50 text-gray-400 cursor-default";
          } else if (hasReading && hasDiary) {
            cellClass +=
              "bg-emerald-50 border-emerald-300 text-emerald-900 hover:bg-emerald-100 cursor-pointer";
          } else if (hasReading) {
            cellClass += "bg-sky-50 border-sky-300 text-sky-900 hover:bg-sky-100 cursor-pointer";
          } else {
            cellClass += "bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100 cursor-pointer";
          }
          if (isToday) cellClass += " ring-2 ring-teal-400 ring-offset-1";
          cells.push(
            <button
              key={`${row}-${col}`}
              type="button"
              onClick={() => isCompleted && setSelectedDayPanel(dateKey)}
              className={cellClass}
            >
              <span>{day}</span>
              {isCompleted && (
                <span className="flex items-center gap-0.5 flex-wrap justify-center max-w-[3rem]">
                  {hasReading && (
                    <span className="text-[9px] font-semibold text-sky-700 bg-sky-100/80 px-0.5 rounded">
                      阅
                    </span>
                  )}
                  {hasDiary && (
                    <span className="text-[9px] font-semibold text-amber-800 bg-amber-100/80 px-0.5 rounded">
                      记
                    </span>
                  )}
                  {hasFeedback && (
                    <span className="text-[9px] text-teal-700 font-semibold">评</span>
                  )}
                </span>
              )}
            </button>
          );
          day++;
        }
      }
      rows.push(
        <div key={row} className="grid grid-cols-7 gap-0.5 sm:gap-1">
          {cells}
        </div>
      );
    }
    return rows;
  }, [viewYear, viewMonth, readingCompletedDates, diaryCompletedDates, datesWithFeedback, todayKey]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-gray-500">加载中…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-4">
        <Alert variant="warning">未登录</Alert>
        <Link href="/login" className="text-teal-600 hover:underline">
          去登录
        </Link>
      </div>
    );
  }

  if (!student) {
    return <Alert variant="error">无法加载学生资料</Alert>;
  }

  const isCurrentMonth = viewYear === new Date().getFullYear() && viewMonth === new Date().getMonth() + 1;

  const historyTitleName = formatStudentDisplayName(student, "同学");

  return (
    <div className="space-y-6 sm:space-y-8 pb-10 sm:pb-12 max-w-3xl mx-auto w-full min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight leading-snug">
            历史学习记录
          </h1>
          <p className="text-xs sm:text-sm text-gray-600 mt-1.5 leading-relaxed break-words">
            {historyTitleName}
            <span className="text-gray-500"> · 打卡与批改</span>
          </p>
        </div>
        <Link href="/student" className="shrink-0 w-full sm:w-auto">
          <Button
            variant="secondary"
            className="w-full sm:w-auto min-h-12 sm:min-h-11 px-5 text-base font-semibold"
          >
            返回上传作业
          </Button>
        </Link>
      </div>

      {/* ① 学习打卡日历（月视图） */}
      <Card className="shadow-sm border-teal-100/50 !p-4 sm:!p-6">
        <CardHeader className="space-y-3 pb-2">
          <CardTitle className="text-lg sm:text-xl leading-snug">打卡日历（按月视图）</CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            阅读完成（蓝「阅」）以 reading_days 为准；日记（黄「记」）以教师标注的 diary_days 为准（可多日，未标注不计入）；两者都有为绿底；「评」表示该日关联日记有教师反馈。
          </CardDescription>
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-3 text-xs sm:text-sm text-gray-600">
            <span className="inline-flex items-center gap-1.5 min-h-8">
              <span className="w-3 h-3 shrink-0 rounded bg-sky-200 border border-sky-400" />{" "}
              阅读完成
            </span>
            <span className="inline-flex items-center gap-1.5 min-h-8">
              <span className="w-3 h-3 shrink-0 rounded bg-amber-200 border border-amber-400" />{" "}
              日记完成
            </span>
            <span className="inline-flex items-center gap-1.5 min-h-8">
              <span className="w-3 h-3 shrink-0 rounded bg-emerald-200 border border-emerald-400" />{" "}
              都完成
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 sm:space-y-5 pt-2 pb-1 sm:pb-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <Button
                variant="secondary"
                className="min-h-11 flex-1 sm:flex-none text-sm sm:text-base"
                onClick={() => {
                  if (viewMonth === 1) {
                    setViewYear((y) => y - 1);
                    setViewMonth(12);
                  } else {
                    setViewMonth((m) => m - 1);
                  }
                }}
              >
                上个月
              </Button>
              <Button
                variant="secondary"
                className="min-h-11 flex-1 sm:flex-none text-sm sm:text-base"
                onClick={() => {
                  if (viewMonth === 12) {
                    setViewYear((y) => y + 1);
                    setViewMonth(1);
                  } else {
                    setViewMonth((m) => m + 1);
                  }
                }}
              >
                下个月
              </Button>
              {!isCurrentMonth && (
                <Button
                  variant="secondary"
                  className="min-h-11 w-full sm:w-auto text-sm sm:text-base"
                  onClick={() => {
                    const now = new Date();
                    setViewYear(now.getFullYear());
                    setViewMonth(now.getMonth() + 1);
                  }}
                >
                  回到本月
                </Button>
              )}
            </div>
            <p className="text-center sm:text-left text-base font-semibold text-gray-800 w-full sm:w-auto sm:ml-1">
              {viewYear}年{viewMonth}月
            </p>
          </div>
          <div className="grid grid-cols-7 gap-0.5 sm:gap-1 mb-1 sm:mb-2">
            {WEEKDAY_LABELS.map((l) => (
              <div
                key={l}
                className="text-center text-[10px] sm:text-xs font-medium text-gray-500 py-0.5 sm:py-1"
              >
                {l}
              </div>
            ))}
          </div>
          <div className="space-y-1">{calendarGrid}</div>

          {selectedDayPanel && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
              onClick={() => setSelectedDayPanel(null)}
              role="dialog"
              aria-modal="true"
              aria-label="当日记录"
            >
              <div
                className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full border border-gray-200"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-medium text-gray-800 mb-3">
                  {formatDateKeyDisplay(selectedDayPanel)}
                </h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="font-medium text-gray-700">日记：</span>
                    {(diaryByDate.get(selectedDayPanel) || []).length > 0 ? (
                      <span>
                        有（
                        {(diaryByDate.get(selectedDayPanel) || []).some(
                          (d) => (d.teacher_feedback || "").trim()
                        )
                          ? "有教师反馈"
                          : "暂无教师反馈"}
                        ）
                      </span>
                    ) : (
                      <span className="text-gray-500">无</span>
                    )}
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">阅读（reading_days）：</span>
                    {(readingByDate.get(selectedDayPanel) || []).length > 0 ? (
                      <span>有（{(readingByDate.get(selectedDayPanel) || []).length} 条记录含该日）</span>
                    ) : (
                      <span className="text-gray-500">无</span>
                    )}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  className="mt-5 w-full min-h-12 text-base"
                  onClick={() => setSelectedDayPanel(null)}
                >
                  关闭
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ② 日记批改反馈（可查看历史） */}
      <Card className="shadow-sm border-teal-100/50 !p-4 sm:!p-6">
        <CardHeader className="space-y-1">
          <CardTitle className="text-base sm:text-xl leading-snug">
            日记批改反馈（可查看历史）
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            按日期倒序，可筛选月份和日
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pb-1 sm:pb-2">
          <div className="flex flex-col sm:flex-row flex-wrap gap-5">
            <div className="min-w-0 flex-1 sm:flex-initial">
              <label className="block text-sm font-medium text-gray-700 mb-2">月份</label>
              <Input
                type="month"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="w-full sm:w-44 min-h-11 text-base"
              />
            </div>
            <div className="min-w-0 flex-1 sm:flex-initial">
              <label className="block text-sm font-medium text-gray-700 mb-2">日</label>
              <Input
                type="text"
                inputMode="numeric"
                value={dayInput}
                onChange={(e) => setDayInput(e.target.value.replace(/\D/g, "").slice(0, 2))}
                placeholder="输入日（如：22）"
                className="w-full sm:w-28 min-h-11 text-base"
              />
              <p className="text-xs sm:text-sm text-gray-500 mt-2 leading-relaxed">
                月份已在上方选择，这里只需要填日期的「日」
              </p>
            </div>
          </div>
          {dayError && (
            <p className="text-sm text-amber-600">{dayError}</p>
          )}
          {diaryFiltered.length === 0 ? (
            <p className="text-gray-500 py-4">
              {dayError ? null : "暂无日记记录"}
            </p>
          ) : (
            <ul className="space-y-6">
              {diaryFiltered.map((r) => (
                <li
                  key={r.id}
                  className="pb-6 border-b border-[var(--card-border)] last:border-0 last:pb-0"
                >
                  <p className="text-base font-medium text-gray-800 mb-2 leading-snug">
                    完成日（统计，可多日）：
                    {(() => {
                      const days = normalizeDiaryDaysArray(r);
                      return days.length ? days.map((d) => formatDateKeyDisplay(d)).join("、") : "—";
                    })()}
                  </p>
                  <div className="mb-3">
                    {r.image_path ? (
                      <button
                        type="button"
                        onClick={() => setLightboxImage(getPublicUrl("diary-images", r.image_path))}
                        className="block text-left"
                      >
                        <img
                          src={getPublicUrl("diary-images", r.image_path)}
                          alt="日记"
                          className="w-full max-w-[min(100%,240px)] max-h-[200px] sm:max-w-[200px] sm:max-h-[160px] object-contain rounded-2xl border border-teal-200 hover:border-teal-400 transition"
                        />
                      </button>
                    ) : (
                      <span className="text-gray-400 text-sm">无图片</span>
                    )}
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-700">教师评语：</span>
                    <p className="text-base text-gray-800 mt-2 whitespace-pre-wrap leading-relaxed">
                      {(r.teacher_feedback || "").trim() || "暂无教师反馈"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={() => setLightboxImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
        >
          <img
            src={lightboxImage}
            alt="日记预览"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
