/** 本地日历 YYYY-MM-DD */

/** 含今天在内的连续 7 个自然日（与旧版 completionStats 一致，用于兼容 getCompletionStats） */
export function rolling7DaysLocal() {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    out.push(localYMD(d));
  }
  return out;
}

export function localYMD(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseYMD(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setHours(12, 0, 0, 0);
  return dt;
}

/** 本地日历日 YYYY-MM-DD → ISO 串，写入 timestamptz（中午本地，避免跨日偏移） */
export function localYmdToNoonIsoString(ymd) {
  return parseYMD(String(ymd).slice(0, 10)).toISOString();
}

export function addDaysYMD(ymd, deltaDays) {
  const d = parseYMD(ymd);
  d.setDate(d.getDate() + deltaDays);
  return localYMD(d);
}

/** 包含 ymd 的所在自然周的周日（本地，00:00 对齐用 parseYMD 中午） */
export function sundayOfWeekContaining(ymd) {
  const d = parseYMD(ymd);
  d.setDate(d.getDate() - d.getDay());
  return localYMD(d);
}

/** 从周日 YMD 起连续 7 天：周日 … 周六 */
export function weekDatesSundayToSaturday(sundayYmd) {
  const out = [];
  for (let i = 0; i < 7; i++) {
    out.push(addDaysYMD(sundayYmd, i));
  }
  return out;
}

/** 周一为一周起点（本地） */
export function mondayOfWeekContaining(ymd) {
  const d = parseYMD(ymd);
  const dow = d.getDay(); // 0 Sun .. 6 Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return localYMD(d);
}

export function sundayOfWeekStartingMonday(monYmd) {
  const d = parseYMD(monYmd);
  d.setDate(d.getDate() + 6);
  return localYMD(d);
}

/** 自然周：周日 ～ 周六（含 today 所在周） */
export function thisWeekRange() {
  const today = localYMD();
  return sundayToSaturdayWeekRangeForSunday(sundayOfWeekContaining(today));
}

/** 给定周日 YMD，返回该周周日～周六（start/end 均为 YYYY-MM-DD） */
export function sundayToSaturdayWeekRangeForSunday(sundayYmd) {
  const sun = String(sundayYmd).slice(0, 10);
  return { start: sun, end: addDaysYMD(sun, 6) };
}

/** 包含 ymd 的一周：周日～周六 */
export function sundayToSaturdayWeekContaining(ymd) {
  return sundayToSaturdayWeekRangeForSunday(sundayOfWeekContaining(ymd));
}

/** 从某个「显示周」的周日整体平移 deltaWeeks（±1 为上一周 / 下一周） */
export function shiftSundayWeekRange(sundayYmd, deltaWeeks) {
  const sun = addDaysYMD(String(sundayYmd).slice(0, 10), deltaWeeks * 7);
  return sundayToSaturdayWeekRangeForSunday(sun);
}

/** @deprecated 曾用于「周一～周日」；请用 thisWeekRange / shiftSundayWeekRange */
export function shiftWeekRange(mondayYmd, deltaWeeks) {
  const mon = addDaysYMD(mondayYmd, deltaWeeks * 7);
  return { start: mon, end: sundayOfWeekStartingMonday(mon) };
}

export function thisMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = localYMD(new Date(y, m, 1));
  const last = new Date(y, m + 1, 0);
  const end = localYMD(last);
  return { start, end };
}

/**
 * 人类可读范围：「4月5日～4月11日」。
 * 同年且为当前公历年：省略年；同年非今年：仅在开头带年；跨年：起止都带年。
 */
export function formatChineseRangeLabel(startYmd, endYmd) {
  const [ys, ms, ds] = String(startYmd)
    .slice(0, 10)
    .split("-")
    .map((x) => parseInt(x, 10));
  const [ye, me, de] = String(endYmd)
    .slice(0, 10)
    .split("-")
    .map((x) => parseInt(x, 10));
  const nowY = new Date().getFullYear();
  if (ys === ye) {
    if (ys === nowY) {
      return `${ms}月${ds}日～${me}月${de}日`;
    }
    return `${ys}年${ms}月${ds}日～${me}月${de}日`;
  }
  return `${ys}年${ms}月${ds}日～${ye}年${me}月${de}日`;
}

/** 含首尾的自然日个数 */
export function countCalendarDaysInclusive(startStr, endStr) {
  const a = parseYMD(startStr);
  const b = parseYMD(endStr);
  if (b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/** 区间内每个 YYYY-MM-DD */
export function buildYmdSetInclusive(rangeStart, rangeEnd) {
  const set = new Set();
  let cur = parseYMD(rangeStart);
  const end = parseYMD(rangeEnd);
  if (end < cur) return set;
  while (cur <= end) {
    set.add(localYMD(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return set;
}

/** ISO 周：周一～周日，返回 { weekStart, weekEnd } 字符串列表覆盖 [semStart, semEnd] */
export function listIsoWeeksIntersecting(semStart, semEnd) {
  const weeks = [];
  let mon = mondayOfWeekContaining(semStart);
  const endD = parseYMD(semEnd);
  for (;;) {
    const sun = sundayOfWeekStartingMonday(mon);
    const monD = parseYMD(mon);
    const sunD = parseYMD(sun);
    if (sunD < parseYMD(semStart)) {
      mon = addDaysYMD(mon, 7);
      continue;
    }
    if (monD > endD) break;
    const ws = mon > semStart ? mon : semStart;
    const we = sun < semEnd ? sun : semEnd;
    if (ws <= we) weeks.push({ weekStart: ws, weekEnd: we });
    mon = addDaysYMD(mon, 7);
  }
  return weeks;
}
