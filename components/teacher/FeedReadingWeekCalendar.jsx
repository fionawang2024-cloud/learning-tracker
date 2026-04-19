"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  normalizeReadingRecordForCalendar,
  getWeekDaysForRecord,
  isReadingDayCompletedFromRecord,
  isReadingDayCompletedStrict,
  getLatestOcrDateStr,
  WEEKDAY_HEADERS_CN,
} from "@/lib/teacherReadingCalendar";

/**
 * 与教师学生详情页一致的 7 日阅读周历；点击日期由父级弹出确认后再写库。
 * @param {object} record — reading_records 行（含 reading_days、daily_records_json）
 * @param {(dateStr: string, currentlyRead: boolean) => void} onDayRequestToggle
 * @param {string} [actionHint] — 覆盖默认「点击」说明（如确认弹窗内即时切换）
 * @param {boolean} [useReadingDaysOnly] — 为 true 时完成态只看 reading_days，不回退 OCR 日表
 */
export function FeedReadingWeekCalendar({ record, onDayRequestToggle, actionHint, useReadingDaysOnly }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const r = normalizeReadingRecordForCalendar(record);
  const weekDays = getWeekDaysForRecord(r, weekOffset);
  const rangeLabel =
    weekDays.length >= 7 ? `${weekDays[0].dateStr} ～ ${weekDays[6].dateStr}` : "—";
  const ocrLatest = getLatestOcrDateStr(r);
  const showOcrDefaultHint = weekOffset === 0 && Boolean(ocrLatest);

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-[var(--card-border)] bg-white/60 p-3">
      <p className="text-xs text-gray-600">当前显示周：{rangeLabel}</p>
      {showOcrDefaultHint && (
        <p className="text-xs text-gray-500">默认依据 OCR 最新识别日期</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          className="px-3 py-1.5 text-xs rounded-xl"
          onClick={() => setWeekOffset((x) => x - 1)}
        >
          上一周
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="px-3 py-1.5 text-xs rounded-xl"
          onClick={() => setWeekOffset((x) => x + 1)}
        >
          下一周
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="px-3 py-1.5 text-xs rounded-xl"
          onClick={() => setWeekOffset(0)}
        >
          回到识别周
        </Button>
      </div>
      <p className="text-xs text-gray-500">
        {actionHint ||
          "本周阅读完成情况（点击日期将弹出确认，不会立即修改）"}
      </p>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-gray-600">
        {WEEKDAY_HEADERS_CN.map((label) => (
          <div key={label} className="py-0.5">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {weekDays.map((d) => {
          const completed = useReadingDaysOnly
            ? isReadingDayCompletedStrict(r, d.dateStr)
            : isReadingDayCompletedFromRecord(r, d.dateStr);
          return (
            <button
              key={d.dateStr}
              type="button"
              className={`rounded-lg py-2 px-1 border text-xs transition-colors ${
                completed
                  ? "bg-teal-500 text-white border-teal-500"
                  : "bg-white text-gray-700 border-gray-200 hover:border-teal-300"
              }`}
              onClick={() => onDayRequestToggle(d.dateStr, completed)}
            >
              <div className="font-medium">{d.labelDay}</div>
              <div className="mt-0.5 text-[10px] opacity-80">{d.dateStr.slice(5)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
