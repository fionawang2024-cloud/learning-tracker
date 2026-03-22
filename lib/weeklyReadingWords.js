/**
 * Weekly new words from cumulative total_words, ordered by record_effective_date
 * (max date in reading_days). Do not use created_at for this metric.
 */

import { normalizeReadingDaysArray } from "@/lib/readingRecordOcr";

export function dateInRange(dateStr, startStr, endStr) {
  const d = dateStr.slice(0, 10);
  return d >= startStr && d <= endStr;
}

/** Latest calendar date in reading_days (chronological max). */
export function recordEffectiveDate(r) {
  const days = normalizeReadingDaysArray(r?.reading_days);
  return days.length ? days[days.length - 1] : null;
}

function compareReadingRowsByEffectiveDateDesc(a, b) {
  const c = b.eff.localeCompare(a.eff);
  if (c !== 0) return c;
  return (Number(b.r.total_words) || 0) - (Number(a.r.total_words) || 0);
}

/**
 * week_end_record = latest record_effective_date in [startStr, endStr]
 * previous_record = latest record_effective_date < startStr
 * @returns { number } weekly new words (total_words delta)
 */
export function computeWeeklyNewWordsFromReadings(readings, startStr, endStr, logOptions = {}) {
  const { log = false, logCtx = {} } = logOptions;

  const list = (readings || []).map((r) => ({ r, eff: recordEffectiveDate(r) }));
  const withEffective = list.filter((x) => x.eff != null);

  const inWeek = withEffective
    .filter((x) => dateInRange(x.eff, startStr, endStr))
    .sort(compareReadingRowsByEffectiveDateDesc);
  const beforeWeek = withEffective
    .filter((x) => x.eff < startStr)
    .sort(compareReadingRowsByEffectiveDateDesc);

  const weekEndRecord = inWeek[0]?.r ?? null;
  const previousRecord = beforeWeek[0]?.r ?? null;

  let weeklyNewWords = 0;
  let rule = "";

  if (weekEndRecord && previousRecord) {
    const endW = Number(weekEndRecord.total_words) || 0;
    const prevW = Number(previousRecord.total_words) || 0;
    weeklyNewWords = endW - prevW;
    rule = "week_end.total_words - previous.total_words";
  } else if (weekEndRecord && !previousRecord) {
    weeklyNewWords = Number(weekEndRecord.total_words) || 0;
    rule = "bootstrap: only week_end_record (use its total_words)";
  } else {
    weeklyNewWords = 0;
    rule = "no week_end_record in range (or no reading_days on any row)";
  }

  if (log) {
    console.log("[weekly-new-words] computeWeeklyNewWordsFromReadings", {
      ...logCtx,
      selected_week_range: `${startStr} ～ ${endStr}`,
      records_debug: (readings || []).map((r) => ({
        id: r.id,
        reading_days: r.reading_days,
        record_effective_date: recordEffectiveDate(r),
        total_words: r.total_words,
        created_at: r.created_at,
      })),
      chosen_week_end_record: weekEndRecord
        ? {
            id: weekEndRecord.id,
            record_effective_date: recordEffectiveDate(weekEndRecord),
            total_words: weekEndRecord.total_words,
          }
        : null,
      chosen_previous_record: previousRecord
        ? {
            id: previousRecord.id,
            record_effective_date: recordEffectiveDate(previousRecord),
            total_words: previousRecord.total_words,
          }
        : null,
      weekly_new_words: weeklyNewWords,
      rule_applied: rule,
    });
  }

  return weeklyNewWords;
}
