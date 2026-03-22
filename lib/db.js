import { supabase } from "./supabaseClient";

export async function getStudentByAuthId(authUserId) {
  const { data, error } = await supabase
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
  const { data, error } = await supabase
    .from("students")
    .insert({
      auth_user_id: user.id,
      email: user.email,
      display_name: displayName,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listStudents() {
  console.log("[db] listStudents request");
  const { data, error } = await supabase.from("students").select("*").order("display_name");
  if (error) throw error;
  return data || [];
}

export async function updateStudentDisplayName(studentId, displayName) {
  const { data, error } = await supabase
    .from("students")
    .update({ display_name: displayName })
    .eq("id", studentId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * After magic-link login: if we have a pending display name from /login and the student
 * has no name or only the default email prefix, update students.display_name and return updated row.
 * getPendingName (e.g. getAndClearPendingDisplayName) is called once and clears localStorage.
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
  const { data, error } = await supabase
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
  const { data, error } = await supabase
    .from("diary_records")
    .select("*")
    .eq("student_id", studentId)
    .order("upload_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listReadingByStudent(studentId) {
  console.log("[db] listReadingByStudent request", { studentId });
  const { data, error } = await supabase
    .from("reading_records")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

const FEED_FETCH_LIMIT = 400;

/** All reading records (teacher dashboard feed). Newest first. */
export async function listAllReadingRecordsForFeed() {
  const { data, error } = await supabase
    .from("reading_records")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(FEED_FETCH_LIMIT);
  if (error) throw error;
  return data || [];
}

/** All diary records (teacher dashboard feed). Newest first. */
export async function listAllDiaryRecordsForFeed() {
  const { data, error } = await supabase
    .from("diary_records")
    .select("*")
    .order("created_at", { ascending: false })
    .order("upload_date", { ascending: false })
    .limit(FEED_FETCH_LIMIT);
  if (error) throw error;
  return data || [];
}

export async function listSpeakingByStudent(studentId) {
  console.log("[db] listSpeakingByStudent request", { studentId });
  const { data, error } = await supabase
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
  const { data, error } = await supabase.from("speaking_scores").select("*").in("student_id", ids);
  if (error) throw error;
  return data || [];
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
 * 指定课程日期的分数 upsert（0=缺勤，1–5=出勤参与度）。
 * 表 speaking_scores；列 student_id, score_date, score；唯一 (student_id, score_date)。
 * 迁移：supabase_schema_speaking_score_date.sql
 */
export async function upsertSpeakingScoreForClassDate(studentId, scoreDateYMD, score) {
  const s = Number(score);
  if (!Number.isInteger(s) || s < 0 || s > 5) {
    throw new Error("speaking score must be integer 0–5");
  }
  const score_date = String(scoreDateYMD || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(score_date)) {
    throw new Error("invalid score_date");
  }

  const payload = { student_id: studentId, score_date, score: s };

  console.log("[db] upsert speaking_scores — about to upsert:", {
    table: SPEAKING_SCORES_TABLE,
    payload,
    student_id: studentId,
    score_date,
    score: s,
    onConflict: SPEAKING_UPSERT_ON_CONFLICT,
  });

  const { data, error } = await supabase
    .from(SPEAKING_SCORES_TABLE)
    .upsert(payload, { onConflict: SPEAKING_UPSERT_ON_CONFLICT })
    .select()
    .single();

  if (error) {
    logSpeakingUpsertError("[db] upsert speaking_scores failed", error);
    throw error;
  }

  console.log("[db] upsert speaking_scores OK:", { returnedId: data?.id, student_id: data?.student_id, score_date: data?.score_date, score: data?.score });
  return data;
}

export async function createDiaryRecord(record) {
  const { data, error } = await supabase
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
  const { data, error } = await supabase
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
      const { data: data2, error: error2 } = await supabase
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

  const { data, error } = await supabase
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
  const { data, error } = await supabase
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
  const { data, error } = await supabase
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
      const { data: data2, error: error2 } = await supabase
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
  const { data, error } = await supabase
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
