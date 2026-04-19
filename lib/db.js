import { getSupabaseClient } from "./supabaseClient";
import { ensureCurrentSemester, getCurrentSemesterInfo } from "./semesterAwardStats";

export async function getStudentByAuthId(authUserId) {
  const { data, error } = await getSupabaseClient()
    .from("students")
    .select("*")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getOrCreateStudent(user) {
  if (!user?.id || !user?.email) return null;
  const existing = await getStudentByAuthId(user.id);
  if (existing) return existing;
  const displayName = (user.email || "").split("@")[0] || user.email;
  let semesterId = null;
  try {
    const sem = await getCurrentSemesterInfo();
    semesterId = sem?.id ?? null;
  } catch {
    semesterId = null;
  }
  const row = {
    auth_user_id: user.id,
    email: user.email,
    display_name: displayName,
    ...(semesterId ? { semester_id: semesterId } : {}),
  };
  let { data, error } = await getSupabaseClient().from("students").insert(row).select().single();
  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (msg.includes("semester_id") || msg.includes("schema cache")) {
      const { data: d2, error: e2 } = await getSupabaseClient()
        .from("students")
        .insert({ auth_user_id: user.id, email: user.email, display_name: displayName })
        .select()
        .single();
      if (e2) throw e2;
      return d2;
    }
    throw error;
  }
  return data;
}

/** 直接查 students 表；无登录态；失败返回 [] 不抛错（老师端页面不因单表失败白屏）。仅当前学期名册。 */
export async function listStudents() {
  try {
    console.log("[db] listStudents request");
    const supabase = getSupabaseClient();
    const sem = await ensureCurrentSemester();
    const semId = sem?.id ?? null;
    if (!semId) {
      throw new Error("current semester is missing id");
    }
    const queryCondition = `semester_id = ${semId} (+ optional legacy semester_id IS NULL)`;
    console.log("[db] listStudents context", {
      currentSemesterId: semId,
      queryCondition,
    });

    const { data: currentRows, error: currentErr } = await supabase
      .from("students")
      .select("*")
      .eq("semester_id", semId)
      .order("display_name");
    if (currentErr) {
      console.error("[db] listStudents Supabase error", {
        currentSemesterId: semId,
        queryCondition: `semester_id = ${semId}`,
        message: currentErr.message,
        details: currentErr.details,
        hint: currentErr.hint,
        code: currentErr.code,
      });
      throw currentErr;
    }

    // 兼容历史老数据（semester_id 为空）并入当前名册。
    let legacyRows = [];
    const { data: nullRows, error: nullErr } = await supabase
      .from("students")
      .select("*")
      .is("semester_id", null)
      .order("display_name");
    if (nullErr) {
      console.warn("[db] listStudents legacy null-semester query failed (ignored)", {
        currentSemesterId: semId,
        message: nullErr.message,
        details: nullErr.details,
        hint: nullErr.hint,
        code: nullErr.code,
      });
    } else {
      legacyRows = nullRows || [];
    }

    const seen = new Set();
    const merged = [...(currentRows || []), ...legacyRows].filter((row) => {
      const id = row?.id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const sorted = merged.sort((a, b) =>
      String(a?.display_name || a?.name || "").localeCompare(String(b?.display_name || b?.name || ""), "zh-Hans-CN")
    );

    console.log("[db] listStudents result", {
      currentSemesterId: semId,
      queryCondition,
      studentsCount: sorted.length,
      names: sorted.map((x) => x.display_name || x.name || ""),
    });
    return sorted;
  } catch (e) {
    console.error("[db] listStudents failed", {
      message: e?.message,
      details: e?.details,
      hint: e?.hint,
      code: e?.code,
    });
    throw e;
  }
}

/**
 * 按姓名查找学生（trim 后与 display_name 或 name 完全匹配）。
 * @param {string|null|undefined} semesterId 若提供则只在该学期名册内查找
 * @returns {Promise<object|null>}
 */
export async function findStudentByTrimmedName(trimmed, semesterId = null) {
  const t = String(trimmed || "").trim();
  if (!t) return null;
  const supabase = getSupabaseClient();
  let q1 = supabase.from("students").select("*").eq("display_name", t);
  if (semesterId) q1 = q1.eq("semester_id", semesterId);
  const { data: byDisplay, error: e1 } = await q1.maybeSingle();
  if (e1 && e1.code !== "PGRST116") throw e1;
  if (byDisplay) return byDisplay;

  let q2 = supabase.from("students").select("*").eq("name", t);
  if (semesterId) q2 = q2.eq("semester_id", semesterId);
  const { data: byName, error: e2 } = await q2.maybeSingle();
  if (e2) {
    const msg = String(e2.message || "").toLowerCase();
    if (msg.includes("column") && msg.includes("name")) return null;
    if (e2.code === "PGRST116") return null;
    throw e2;
  }
  return byName;
}

/**
 * 老师手动添加学生：同名则不再插入，仅返回已有行。
 * @param {string} name
 * @returns {Promise<{ student: object, created: boolean }>}
 * @throws {Error} 姓名为空时 message 为「请输入学生姓名」
 */
export async function createStudentIfNotExists(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) {
    throw new Error("请输入学生姓名");
  }

  const sem = await ensureCurrentSemester();
  const semesterId = sem?.id ?? null;
  if (!semesterId) {
    throw new Error("当前学期不存在，无法添加学生");
  }
  console.log("[db] createStudentIfNotExists context", { currentSemesterId: semesterId, name: trimmed });

  const existing = await findStudentByTrimmedName(trimmed, semesterId || undefined);
  if (existing) {
    return { student: existing, created: false };
  }

  const supabase = getSupabaseClient();
  const fakeMail = `manual-${Date.now()}-${Math.random().toString(16).slice(2, 10)}@manual.local`;
  const authUserId =
    typeof globalThis !== "undefined" && globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const base = {
    display_name: trimmed,
    email: fakeMail,
    auth_user_id: authUserId,
    semester_id: semesterId,
  };
  const insertPayload = { ...base, name: trimmed };
  console.log("[db] createStudentIfNotExists insert payload", {
    currentSemesterId: semesterId,
    insertPayload,
  });

  let ins = await supabase.from("students").insert(insertPayload).select("*").single();
  if (ins.error) {
    console.warn("[db] createStudentIfNotExists: insert with name failed, retry without name:", ins.error?.message);
    ins = await supabase.from("students").insert(base).select("*").single();
  }
  if (ins.error) throw ins.error;
  console.log("[db] createStudentIfNotExists created student", {
    currentSemesterId: semesterId,
    student: ins.data,
    insertedStudent: {
      id: ins.data?.id,
      name: ins.data?.display_name || ins.data?.name || "",
      semester_id: ins.data?.semester_id ?? null,
    },
  });
  return { student: ins.data, created: true };
}

/** @alias 与 createStudentIfNotExists 相同 */
export const addStudentByName = createStudentIfNotExists;

export async function updateStudentDisplayName(studentId, displayName) {
  const { data, error } = await getSupabaseClient()
    .from("students")
    .update({ display_name: displayName })
    .eq("id", studentId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Legacy / one-off: if localStorage pending name exists (old flows) and display_name is still
 * empty or equals the email prefix, apply it once. Normal login no longer writes pending names.
 * getPendingName (e.g. getAndClearPendingDisplayName) clears localStorage when consumed.
 */
export async function ensureStudentDisplayNameIfEmpty(student, user, getPendingName) {
  if (!student?.id || !user?.email) return student;
  const pending = getPendingName ? getPendingName(user.email) : null;
  if (!pending) return student;
  const defaultPrefix = (user.email || "").split("@")[0] || "";
  const current = (student.display_name || "").trim();
  if (current && current !== defaultPrefix) return student;
  const updated = await updateStudentDisplayName(student.id, pending);
  return updated;
}

export async function updateStudentSpeakingFlag(studentId, isSpeakingStudent) {
  const { data, error } = await getSupabaseClient()
    .from("students")
    .update({ is_speaking_student: isSpeakingStudent })
    .eq("id", studentId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listDiaryByStudent(studentId) {
  console.log("[db] listDiaryByStudent request", { studentId });
  const { data, error } = await getSupabaseClient()
    .from("diary_records")
    .select("*")
    .eq("student_id", studentId)
    .order("upload_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listReadingByStudent(studentId) {
  console.log("[db] listReadingByStudent request", { studentId });
  const { data, error } = await getSupabaseClient()
    .from("reading_records")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

const FEED_FETCH_LIMIT = 400;

/** 直接查 reading_records；无登录态；失败返回 []。 */
export async function listAllReadingRecordsForFeed() {
  try {
    const { data, error } = await getSupabaseClient()
      .from("reading_records")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(FEED_FETCH_LIMIT);
    if (error) {
      console.error("[db] listAllReadingRecordsForFeed Supabase error:", error);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error("[db] listAllReadingRecordsForFeed failed:", e);
    return [];
  }
}

/** 直接查 diary_records；无登录态；失败返回 []。 */
export async function listAllDiaryRecordsForFeed() {
  try {
    const { data, error } = await getSupabaseClient()
      .from("diary_records")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(FEED_FETCH_LIMIT);
    if (error) {
      console.error("[db] listAllDiaryRecordsForFeed Supabase error:", error);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error("[db] listAllDiaryRecordsForFeed failed:", e);
    return [];
  }
}

export async function listSpeakingByStudent(studentId) {
  console.log("[db] listSpeakingByStudent request", { studentId });
  const { data, error } = await getSupabaseClient()
    .from("speaking_scores")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** 教师口语课 tab 等：优先 score_date，其次旧列 class_date，再退回 created_at 日 */
export function speakingScoreClassDate(row) {
  if (!row) return "";
  if (row.score_date) return String(row.score_date).slice(0, 10);
  if (row.class_date) return String(row.class_date).slice(0, 10);
  return row.created_at ? String(row.created_at).slice(0, 10) : "";
}

/**
 * 周报「口语课参与度」等汇总：只认 score_date / 旧 class_date，不用 created_at。
 */
export function speakingScoreDateForReport(row) {
  if (!row) return "";
  if (row.score_date) return String(row.score_date).slice(0, 10);
  if (row.class_date) return String(row.class_date).slice(0, 10);
  return "";
}

function logSpeakingUpsertError(prefix, err) {
  console.error(`${prefix} raw:`, err);
  console.error(`${prefix} message:`, err?.message);
  console.error(`${prefix} details:`, err?.details);
  console.error(`${prefix} hint:`, err?.hint);
  console.error(`${prefix} code:`, err?.code);
  console.error(`${prefix} status:`, err?.status);
  try {
    console.error(`${prefix} serialized:`, JSON.stringify(err, Object.getOwnPropertyNames(err ?? {})));
  } catch {
    console.error(`${prefix} (could not serialize error object)`);
  }
}

/** 批量拉取多名学生的口语分数（教师端口语课 tab） */
export async function listSpeakingScoresForStudents(studentIds) {
  const ids = (studentIds || []).filter(Boolean);
  if (ids.length === 0) return [];
  console.log("[db] listSpeakingScoresForStudents request", { count: ids.length });
  const { data, error } = await getSupabaseClient().from("speaking_scores").select("*").in("student_id", ids);
  if (error) throw error;
  return data || [];
}

/** 口语记录：按 score_date 落在 [startYmd, endYmd]（含）内拉取，供上传页按周展示 */
export async function listSpeakingScoresInRange(startYmd, endYmd) {
  try {
    const start = String(startYmd || "").slice(0, 10);
    const end = String(endYmd || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
    const { data, error } = await getSupabaseClient()
      .from("speaking_scores")
      .select("*")
      .gte("score_date", start)
      .lte("score_date", end)
      .order("score_date", { ascending: false })
      .limit(4000);
    if (error) {
      console.error("[db] listSpeakingScoresInRange", error);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error("[db] listSpeakingScoresInRange failed", e);
    return [];
  }
}

function localDateYMD(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const SPEAKING_SCORES_TABLE = "speaking_scores";
const SPEAKING_UPSERT_ON_CONFLICT = "student_id,score_date";

/**
 * 指定课程日期的分数或请假 upsert。
 * - 数字 0–5：正常出勤参与度；status=present
 * - 字符串 "leave"：请假；score=null，status=absent_excused
 * 迁移：supabase_schema_speaking_score_date.sql、supabase_schema_speaking_status.sql
 */
export async function upsertSpeakingScoreForClassDate(studentId, scoreDateYMD, scoreOrLeave) {
  const score_date = String(scoreDateYMD || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(score_date)) {
    throw new Error("invalid score_date");
  }

  let payload;
  if (scoreOrLeave === "leave") {
    payload = {
      student_id: studentId,
      score_date,
      score: null,
      status: "absent_excused",
    };
  } else {
    const s = Number(scoreOrLeave);
    if (!Number.isInteger(s) || s < 0 || s > 5) {
      throw new Error("speaking score must be integer 0–5, or use leave");
    }
    payload = { student_id: studentId, score_date, score: s, status: "present" };
  }

  console.log("[db] upsert speaking_scores — about to upsert:", {
    table: SPEAKING_SCORES_TABLE,
    payload,
    student_id: studentId,
    score_date,
    onConflict: SPEAKING_UPSERT_ON_CONFLICT,
  });

  const { data, error } = await getSupabaseClient()
    .from(SPEAKING_SCORES_TABLE)
    .upsert(payload, { onConflict: SPEAKING_UPSERT_ON_CONFLICT })
    .select()
    .single();

  if (error) {
    logSpeakingUpsertError("[db] upsert speaking_scores failed", error);
    throw error;
  }

  console.log("[db] upsert speaking_scores OK:", {
    returnedId: data?.id,
    student_id: data?.student_id,
    score_date: data?.score_date,
    score: data?.score,
    status: data?.status,
  });
  return data;
}

export async function createDiaryRecord(record) {
  const { data, error } = await getSupabaseClient()
    .from("diary_records")
    .insert(record)
    .select()
    .single();
  if (error) throw error;
  return data;
}

const READING_CORE_FIELDS = [
  "student_id",
  "upload_date",
  "image_path",
  "total_words",
  "total_time_minutes",
  "weekly_new_words",
  "weekly_new_time",
];
const READING_OPTIONAL_OCR_FIELDS = [
  "extraction_status",
  "total_reading_days",
  "confidence",
  "raw_text",
  "total_books",
  "daily_records_json",
  "reading_days",
];

/** OCR follow-up UPDATE: totals + OCR json fields only (do not rewrite student_id / upload_date / image_path). */
const READING_OCR_PERSIST_KEYS = [
  "total_words",
  "total_time_minutes",
  "weekly_new_words",
  "weekly_new_time",
  ...READING_OPTIONAL_OCR_FIELDS,
];

function pick(obj, keys) {
  const out = {};
  keys.forEach((k) => {
    if (obj.hasOwnProperty(k)) out[k] = obj[k];
  });
  return out;
}

function summarizeReadingInsertPayload(payload) {
  const daily = payload.daily_records_json;
  return {
    student_id: payload.student_id,
    upload_date: payload.upload_date,
    total_words: payload.total_words,
    total_time_minutes: payload.total_time_minutes,
    total_books: payload.total_books,
    total_reading_days: payload.total_reading_days,
    weekly_new_words: payload.weekly_new_words,
    weekly_new_time: payload.weekly_new_time,
    extraction_status: payload.extraction_status,
    confidence: payload.confidence,
    daily_records_json_length: Array.isArray(daily) ? daily.length : daily == null ? null : "non-array",
    reading_days: payload.reading_days,
    raw_text_length: typeof payload.raw_text === "string" ? payload.raw_text.length : null,
  };
}

export async function createReadingRecord(record) {
  const uploadDate = record.upload_date != null && record.upload_date !== ""
    ? record.upload_date
    : new Date().toISOString().slice(0, 10);
  const core = { ...pick(record, READING_CORE_FIELDS), upload_date: uploadDate };
  const optional = pick(record, READING_OPTIONAL_OCR_FIELDS);
  const payload = { ...core, ...optional };
  console.log("[db] createReadingRecord Supabase INSERT payload (summary):", summarizeReadingInsertPayload(payload));
  const { data, error } = await getSupabaseClient()
    .from("reading_records")
    .insert(payload)
    .select()
    .single();
  if (error) {
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("column") || msg.includes("schema") || msg.includes("extraction_status") || msg.includes("total_reading_days") || msg.includes("confidence") || msg.includes("raw_text") || msg.includes("total_books") || msg.includes("daily_records_json") || msg.includes("reading_days")) {
      console.warn(
        "[db] createReadingRecord: first insert failed (likely missing OCR columns). Retrying CORE-ONLY — daily_records_json & reading_days NOT saved:",
        error.message,
        "dropped optional keys:",
        Object.keys(optional)
      );
      const fallback = { ...core };
      const { data: data2, error: error2 } = await getSupabaseClient()
        .from("reading_records")
        .insert(fallback)
        .select()
        .single();
      if (error2) throw error2;
      console.warn("[db] createReadingRecord: saved row without OCR fields. Run supabase_schema_reading_extraction.sql on DB.");
      return data2;
    }
    throw error;
  }
  console.log("[db] createReadingRecord Supabase INSERT OK returned row:", summarizeReadingInsertPayload({ ...data }));
  return data;
}

/**
 * Second-step persistence after OCR: UPDATE the row by id with full OCR + totals.
 * Does not use updateReadingRecord's schema fallback (so missing columns surface as real errors).
 */
export async function persistReadingOcrToRecord(recordId, fields) {
  if (recordId == null || recordId === "") {
    console.error("[db] persistReadingOcrToRecord: missing recordId");
    throw new Error("persistReadingOcrToRecord: missing reading record id");
  }
  const payload = pick(fields, READING_OCR_PERSIST_KEYS);
  Object.keys(payload).forEach((k) => {
    if (payload[k] === undefined) delete payload[k];
  });

  const logPayload = {
    ...summarizeReadingInsertPayload({
      ...payload,
      student_id: fields.student_id ?? "(not sent on update)",
      upload_date: fields.upload_date ?? null,
      image_path: fields.image_path ?? null,
    }),
    reading_record_id: recordId,
    raw_text_chars: typeof payload.raw_text === "string" ? payload.raw_text.length : null,
  };

  console.log("[db] persistReadingOcrToRecord: target reading_records.id =", String(recordId));
  console.log("[db] persistReadingOcrToRecord: UPDATE payload (summary) =", logPayload);

  const { data, error } = await getSupabaseClient()
    .from("reading_records")
    .update(payload)
    .eq("id", recordId)
    .select()
    .single();

  if (error) {
    console.error("[db] persistReadingOcrToRecord: Supabase UPDATE FAILED", {
      reading_record_id: recordId,
      error: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    throw error;
  }

  console.log("[db] persistReadingOcrToRecord: Supabase UPDATE SUCCESS", {
    reading_record_id: recordId,
    returned_row_summary: summarizeReadingInsertPayload({ ...data }),
    reading_days_in_row: data?.reading_days ?? null,
    daily_records_json_length: Array.isArray(data?.daily_records_json) ? data.daily_records_json.length : null,
  });
  return data;
}

export async function updateDiaryRecord(id, updates) {
  console.log("[db] updateDiaryRecord request", { id, updates });
  const { data, error } = await getSupabaseClient()
    .from("diary_records")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateReadingRecord(id, updates) {
  const safe = pick(updates, [...READING_CORE_FIELDS, ...READING_OPTIONAL_OCR_FIELDS]);
  console.log("[db] updateReadingRecord request", { id, safe });
  const { data, error } = await getSupabaseClient()
    .from("reading_records")
    .update(safe)
    .eq("id", id)
    .select()
    .single();
  console.log("[db] updateReadingRecord response", {
    id,
    data,
    error,
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
  });
  if (error) {
    console.error("[db] updateReadingRecord error:", error);
    console.error("[db] updateReadingRecord details:", error?.message, error?.details, error?.hint);
    const msg = (error.message || "").toLowerCase();
    if (
      msg.includes("column") ||
      msg.includes("schema") ||
      msg.includes("extraction_status") ||
      msg.includes("total_reading_days") ||
      msg.includes("confidence") ||
      msg.includes("raw_text") ||
      msg.includes("total_books") ||
      msg.includes("daily_records_json") ||
      msg.includes("reading_days")
    ) {
      const fallback = pick(updates, READING_CORE_FIELDS);
      console.log("[db] updateReadingRecord fallback request", { id, fallback });
      const { data: data2, error: error2 } = await getSupabaseClient()
        .from("reading_records")
        .update(fallback)
        .eq("id", id)
        .select()
        .single();
      if (error2) {
        console.error("[db] updateReadingRecord fallback error:", error2);
        console.error("[db] updateReadingRecord fallback details:", error2?.message, error2?.details, error2?.hint);
        throw error2;
      }
      return data2;
    }
    throw error;
  }
  return data;
}

/** 学生详情页添分：默认课程日期为当天（本地），同一天重复提交则为更新 */
export async function createSpeakingScore(studentId, score, scoreDateYMD) {
  const score_date = scoreDateYMD || localDateYMD();
  return upsertSpeakingScoreForClassDate(studentId, score_date, score);
}

export async function getLatestReadingRecordBefore(studentId, beforeCreatedAt) {
  const { data, error } = await getSupabaseClient()
    .from("reading_records")
    .select("total_words, total_time_minutes")
    .eq("student_id", studentId)
    .lt("created_at", beforeCreatedAt)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getLatestReadingRecordBeforeDate(studentId, beforeDateStr) {
  const before = beforeDateStr + "T00:00:00.000Z";
  return getLatestReadingRecordBefore(studentId, before);
}

export { getCompletionStats, getRangeStats } from "./completionStats";
export { stableEncouragementForStudentId, COMPLETION_ENCOURAGEMENTS } from "./stableEncouragement";
export {
  getCurrentSemesterAwardStats,
  getCurrentSemesterInfo,
  ensureCurrentSemester,
  buildSemesterAwardRows,
  getWeekWordTotalsByStudent,
  updateCurrentSemesterStartYmd,
} from "./semesterAwardStats";
export { runStartNewSemester } from "./semesterLifecycle";
