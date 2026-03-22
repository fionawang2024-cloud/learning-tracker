"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  normalizeDiaryDaysArray,
  getDiaryWeekDaysForRecord,
  normalizeDiaryDateYMD,
} from "@/lib/diaryDate";

/**
 * 多选日记完成日：点击切换选中，每次变更立即回调父级写 diary_days。
 */
export function DiaryWeekDaysPicker({ diaryRecord, onChangeDiaryDays, disabled = false, saving = false }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const weekDays = getDiaryWeekDaysForRecord(diaryRecord, weekOffset);
  const rangeLabel =
    weekDays.length >= 7 ? `${weekDays[0].dateStr} ～ ${weekDays[6].dateStr}` : "—";
  const selectedAsc = normalizeDiaryDaysArray(diaryRecord);
  const selectedSet = new Set(selectedAsc);
  const uploadYMD = normalizeDiaryDateYMD(diaryRecord?.upload_date);
  const showAnchorHint = weekOffset === 0 && selectedAsc.length === 0 && Boolean(uploadYMD || diaryRecord?.created_at);

  function toggle(dateStr) {
    const next = new Set(selectedSet);
    if (next.has(dateStr)) next.delete(dateStr);
    else next.add(dateStr);
    const sorted = Array.from(next).sort();
    onChangeDiaryDays(sorted);
  }

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-[var(--card-border)] bg-white/60 p-3">
      <p className="text-xs font-medium text-gray-700">标注日记完成日（可多选）</p>
      <p className="text-xs text-gray-600">当前显示周：{rangeLabel}</p>
      {showAnchorHint && (
        <p className="text-xs text-gray-500">可切换周历；点击日期加入或取消完成日，变更后立即保存</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          className="px-3 py-1.5 text-xs rounded-xl"
          disabled={disabled || saving}
          onClick={() => setWeekOffset((x) => x - 1)}
        >
          上一周
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="px-3 py-1.5 text-xs rounded-xl"
          disabled={disabled || saving}
          onClick={() => setWeekOffset((x) => x + 1)}
        >
          下一周
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="px-3 py-1.5 text-xs rounded-xl"
          disabled={disabled || saving}
          onClick={() => setWeekOffset(0)}
        >
          回到识别周
        </Button>
      </div>
      <p className="text-xs text-gray-500">同一篇上传可对应多天内容；选中为已完成，再点可取消</p>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {weekDays.map((d) => {
          const on = selectedSet.has(d.dateStr);
          const uploadHint = !on && uploadYMD && d.dateStr === uploadYMD;
          return (
            <button
              key={d.dateStr}
              type="button"
              disabled={disabled || saving}
              className={`rounded-lg py-2 px-1 border text-xs transition-colors ${
                on
                  ? "bg-teal-500 text-white border-teal-500"
                  : uploadHint
                    ? "bg-white text-gray-800 border-dashed border-amber-400"
                    : "bg-white text-gray-700 border-gray-200 hover:border-teal-300"
              }`}
              onClick={() => toggle(d.dateStr)}
            >
              <div>{d.labelDay}日</div>
              <div className="mt-0.5 text-[10px] opacity-80">{d.weekday}</div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-gray-600">
        已选完成日：
        <span className="font-medium text-teal-800">
          {selectedAsc.length ? selectedAsc.join("、") : "无（统计不计入，直至标注）"}
        </span>
      </p>
    </div>
  );
}
