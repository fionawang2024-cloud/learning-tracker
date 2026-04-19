import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { deriveReadingDaysDescending, normalizeRowDateString } from "@/lib/readingRecordOcr";
import { supabaseNoAuthClientOptions } from "@/lib/supabaseClient";
import { fetchOpenSemesterRow } from "@/lib/semesterAwardStats";

/** 空字符串 → null；否则须匹配非负整数（含 0） */
function parseOptionalNonNegInt(formData, key, label) {
  const v = formData.get(key);
  if (v == null || String(v).trim() === "") return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) throw new Error(`${label}须为 0 或正整数`);
  return parseInt(s, 10);
}

function parseOptionalTotalTimeMinutes(formData) {
  const v = formData.get("total_time_minutes");
  if (v == null || String(v).trim() === "") return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) throw new Error("总时间（换算后的分钟）须为 0 或正整数");
  return parseInt(s, 10);
}

/** 老师确认的日期列表 → 库内统一为去重、升序再倒序（新→旧） */
function normalizeTeacherReadingDays(readingDaysRaw, dailyRecords) {
  if (!Array.isArray(readingDaysRaw)) return deriveReadingDaysDescending(dailyRecords);
  if (readingDaysRaw.length === 0) return [];
  const asc = [...new Set(readingDaysRaw.map((d) => normalizeRowDateString(d)).filter(Boolean))].sort();
  return asc.length ? [...asc].reverse() : [];
}

function serverSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  return createClient(url, key, supabaseNoAuthClientOptions);
}

/** 仅打印 host，不打印 key */
function getSupabaseHostForLog() {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  try {
    if (!u) return "(empty NEXT_PUBLIC_SUPABASE_URL)";
    return new URL(u).host;
  } catch {
    return `(unparseable URL, len=${u.length})`;
  }
}

function logSupabaseStepFailure(tag, { table, operation, payloadSummary, error }) {
  console.error(tag, {
    table,
    operation,
    payloadSummary,
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
    code: error?.code,
    raw: error,
  });
}

/**
 * 按步骤执行保存；每一步单独记录，失败时抛出带步骤前缀的 Error。
 * 涉及表：students（select / insert）、Storage bucket reading-images（upload）、reading_records（insert）
 */
async function saveReadingRecordPipeline(supabase, ctx) {
  const {
    confirmed,
    image,
    totalWords,
    totalTime,
    totalBooks,
    totalDays,
    weeklyNewWords,
    dailyRecords,
    readingDaysRaw,
    rawText,
    extractionStatus,
    currentSemesterId,
  } = ctx;

  console.log("[save] start", {
    supabaseHost: getSupabaseHostForLog(),
    confirmedStudentName: confirmed,
    imageName: image?.name,
    imageType: image?.type,
    totalWords,
    totalTimeMinutes: totalTime,
    totalBooks,
    totalReadingDays: totalDays,
    weeklyNewWords,
    dailyRecordsLength: Array.isArray(dailyRecords) ? dailyRecords.length : null,
    readingDaysRawLength: Array.isArray(readingDaysRaw) ? readingDaysRaw.length : null,
    rawTextChars: rawText.length,
    extractionStatus,
  });

  const cleaned = String(confirmed || "").trim();
  if (!cleaned) throw new Error("student_name 不能为空");

  let student;

  // --- Step 1a: students | select | by display_name ---
  console.log("[save] step 1a: table=students | op=select | filter=display_name", {
    display_name: cleaned,
  });
  try {
    let qDisplay = supabase.from("students").select("*").eq("display_name", cleaned);
    if (currentSemesterId) qDisplay = qDisplay.eq("semester_id", currentSemesterId);
    const { data, error } = await qDisplay.maybeSingle();
    if (error) {
      logSupabaseStepFailure("[save] students step 1a failed", {
        table: "students",
        operation: "select",
        payloadSummary: { eq: { display_name: cleaned } },
        error,
      });
      throw new Error(`students step 1a (select by display_name) failed: ${error?.message || "unknown error"}`);
    }
    if (data) {
      console.log("[save] step 1a ok: student found by display_name", { student_id: data.id });
      student = data;
    }
  } catch (e) {
    if (String(e?.message || "").startsWith("students step 1a")) throw e;
    console.error("[save] step 1a unexpected", e);
    throw new Error(`students step 1a (select by display_name) failed: ${e?.message || String(e)}`);
  }

  if (!student) {
    // --- Step 1b: students | select | by name ---
    console.log("[save] step 1b: table=students | op=select | filter=name", { name: cleaned });
    try {
      let qName = supabase.from("students").select("*").eq("name", cleaned);
      if (currentSemesterId) qName = qName.eq("semester_id", currentSemesterId);
      const { data, error } = await qName.maybeSingle();
      if (error && error.code !== "PGRST116") {
        const msg = String(error.message || "").toLowerCase();
        const ignorable = msg.includes("column") && msg.includes("name");
        if (!ignorable) {
          logSupabaseStepFailure("[save] students step 1b failed", {
            table: "students",
            operation: "select",
            payloadSummary: { eq: { name: cleaned } },
            error,
          });
          throw new Error(`students step 1b (select by name) failed: ${error?.message || "unknown error"}`);
        }
      }
      if (data) {
        console.log("[save] step 1b ok: student found by name", { student_id: data.id });
        student = data;
      }
    } catch (e) {
      if (String(e?.message || "").startsWith("students step 1b")) throw e;
      console.error("[save] step 1b unexpected", e);
      throw new Error(`students step 1b (select by name) failed: ${e?.message || String(e)}`);
    }
  }

  if (!student) {
    const fakeMail = `manual-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@manual.local`;
    const baseRow = {
      display_name: cleaned,
      email: fakeMail,
      auth_user_id: randomUUID(),
      ...(currentSemesterId ? { semester_id: currentSemesterId } : {}),
    };

    // --- Step 1c: students | insert | with name column ---
    console.log("[save] step 1c: table=students | op=insert | variant=with_name_column", {
      display_name: baseRow.display_name,
      email: baseRow.email,
      auth_user_id: baseRow.auth_user_id,
      name: cleaned,
    });
    try {
      let ins = await supabase.from("students").insert({ ...baseRow, name: cleaned }).select("*").single();
      if (ins.error) {
        console.warn("[save] step 1c insert with name column failed, retry without name:", {
          message: ins.error?.message,
          details: ins.error?.details,
          hint: ins.error?.hint,
          code: ins.error?.code,
        });
        // --- Step 1d: students | insert | without name column ---
        console.log("[save] step 1d: table=students | op=insert | variant=baseRow_only", {
          display_name: baseRow.display_name,
          email: baseRow.email,
          auth_user_id: baseRow.auth_user_id,
        });
        ins = await supabase.from("students").insert(baseRow).select("*").single();
        if (ins.error) {
          logSupabaseStepFailure("[save] students step 1d failed", {
            table: "students",
            operation: "insert",
            payloadSummary: { keys: Object.keys(baseRow) },
            error: ins.error,
          });
          throw new Error(`students step 1d (insert without name) failed: ${ins.error?.message || "unknown error"}`);
        }
        student = ins.data;
        console.log("[save] step 1d ok: student inserted", { student_id: student.id });
      } else {
        student = ins.data;
        console.log("[save] step 1c ok: student inserted", { student_id: student.id });
      }
    } catch (e) {
      if (String(e?.message || "").startsWith("students step 1")) throw e;
      console.error("[save] step 1c/1d unexpected", e);
      throw new Error(`students step insert failed: ${e?.message || String(e)}`);
    }
  }

  const ext = String(image.name || "jpg").split(".").pop();
  const filePath = `${student.id}/${Date.now()}-${randomUUID()}.${ext}`;
  let fileBuffer;
  try {
    fileBuffer = Buffer.from(await image.arrayBuffer());
  } catch (readErr) {
    console.error("[save] step 2: failed to read image bytes (continuing without upload)", readErr);
    fileBuffer = null;
  }

  /** 上传失败或非阻塞场景下可为 null，不阻塞 reading_records 插入 */
  let imagePathForDb = null;

  // --- Step 2: storage | upload | bucket reading-images（可选：RLS 等失败时仅打日志，仍保存记录）---
  if (fileBuffer && fileBuffer.length > 0) {
    console.log("[save] step 2: storage bucket=reading-images | op=upload (optional)", {
      filePath,
      contentType: image.type || "image/jpeg",
      bytes: fileBuffer.length,
    });
    const { error: uploadErr } = await supabase.storage
      .from("reading-images")
      .upload(filePath, fileBuffer, { contentType: image.type || "image/jpeg", upsert: false });
    if (uploadErr) {
      logSupabaseStepFailure("[save] storage step 2 failed (non-blocking)", {
        table: "storage.reading-images",
        operation: "upload",
        payloadSummary: { filePath, contentType: image.type },
        error: uploadErr,
      });
      console.error("[save] storage upload failed; continuing with image_path=null", {
        message: uploadErr?.message,
        details: uploadErr?.details,
        hint: uploadErr?.hint,
        code: uploadErr?.code,
      });
      imagePathForDb = null;
    } else {
      imagePathForDb = filePath;
      console.log("[save] step 2 ok: file uploaded", { filePath });
    }
  } else {
    console.warn("[save] step 2 skipped: empty or missing image buffer");
  }

  const normalizedDays = normalizeTeacherReadingDays(readingDaysRaw, dailyRecords);

  const insertRow = {
    student_id: student.id,
    upload_date: new Date().toISOString().slice(0, 10),
    image_path: imagePathForDb,
    total_words: totalWords,
    total_time_minutes: totalTime,
    total_books: totalBooks,
    total_reading_days: totalDays,
    daily_records_json: dailyRecords,
    extraction_status: extractionStatus,
    reading_days: normalizedDays,
  };
  if (rawText.length > 0) insertRow.raw_text = rawText;

  // --- Step 3: reading_records | insert ---
  console.log("[save] step 3: table=reading_records | op=insert", {
    keys: Object.keys(insertRow),
    student_id: insertRow.student_id,
    upload_date: insertRow.upload_date,
    image_path: insertRow.image_path,
    reading_days_count: Array.isArray(insertRow.reading_days) ? insertRow.reading_days.length : null,
    daily_records_json_count: Array.isArray(insertRow.daily_records_json) ? insertRow.daily_records_json.length : null,
    has_raw_text: Boolean(insertRow.raw_text),
  });
  try {
    const { data, error } = await supabase.from("reading_records").insert(insertRow).select("*").single();
    if (error) {
      logSupabaseStepFailure("[save] reading_records step 3 failed", {
        table: "reading_records",
        operation: "insert",
        payloadSummary: {
          student_id: insertRow.student_id,
          upload_date: insertRow.upload_date,
          image_path: insertRow.image_path,
          keys: Object.keys(insertRow),
        },
        error,
      });
      throw new Error(`reading_records step 3 (insert) failed: ${error?.message || "unknown error"}`);
    }
    console.log("[save] success", { reading_record_id: data?.id });
    return { student, reading_record: data };
  } catch (e) {
    if (String(e?.message || "").startsWith("reading_records step 3")) throw e;
    console.error("[save] step 3 unexpected", e);
    throw new Error(`reading_records step 3 (insert) failed: ${e?.message || String(e)}`);
  }
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const image = formData.get("image");
    const confirmed =
      String(formData.get("confirmed_student_name") ?? formData.get("student_name") ?? "").trim();
    const ocrStudentNameRaw = String(formData.get("ocr_student_name") ?? "").trim();
    const extractionStatus = String(formData.get("extraction_status") || "needs_review");
    let totalWords;
    let totalTime;
    let totalBooks;
    let totalDays;
    let weeklyNewWords;
    try {
      totalWords = parseOptionalNonNegInt(formData, "total_words", "总单词数");
      totalTime = parseOptionalTotalTimeMinutes(formData);
      totalBooks = parseOptionalNonNegInt(formData, "total_books", "总本数");
      totalDays = parseOptionalNonNegInt(formData, "total_reading_days", "连续阅读天数");
      weeklyNewWords = parseOptionalNonNegInt(formData, "weekly_new_words", "本周新单词");
    } catch (ve) {
      return Response.json({ ok: false, error: ve?.message || String(ve) }, { status: 400 });
    }
    const dailyJsonRaw = formData.get("daily_records_json") ?? formData.get("daily_records");
    let dailyRecords;
    try {
      dailyRecords = JSON.parse(String(dailyJsonRaw || "[]"));
    } catch {
      return Response.json({ ok: false, error: "daily_records_json 不是合法 JSON" }, { status: 400 });
    }
    if (!Array.isArray(dailyRecords)) {
      return Response.json({ ok: false, error: "daily_records_json 须为数组" }, { status: 400 });
    }
    let readingDaysRaw;
    try {
      readingDaysRaw = JSON.parse(String(formData.get("reading_days") || "[]"));
    } catch {
      return Response.json({ ok: false, error: "reading_days 不是合法 JSON" }, { status: 400 });
    }
    if (!Array.isArray(readingDaysRaw)) {
      return Response.json({ ok: false, error: "reading_days 须为字符串日期数组" }, { status: 400 });
    }
    const rawText = String(formData.get("raw_text") ?? "");

    if (!image || typeof image === "string") {
      return Response.json({ ok: false, error: "缺少图片文件" }, { status: 400 });
    }

    if (!confirmed) {
      return Response.json({ ok: false, error: "请先填写学生姓名（confirmed_student_name 不能为空）" }, { status: 400 });
    }

    const supabase = serverSupabase();
    const { data: openSemRow } = await fetchOpenSemesterRow(supabase);
    const currentSemesterId = openSemRow?.id ?? null;
    console.log("[save-reading-record] POST", {
      supabaseHost: getSupabaseHostForLog(),
      confirmed,
      ocrStudentName: ocrStudentNameRaw || "(none)",
      currentSemesterId,
    });

    const { student, reading_record } = await saveReadingRecordPipeline(supabase, {
      confirmed,
      image,
      totalWords,
      totalTime,
      totalBooks,
      totalDays,
      weeklyNewWords,
      dailyRecords,
      readingDaysRaw,
      rawText,
      extractionStatus,
      currentSemesterId,
    });

    return Response.json({ ok: true, student, reading_record });
  } catch (e) {
    const msg = e?.message || String(e);
    console.error("[save-reading-record] POST catch:", msg, e);
    return Response.json({ ok: false, error: msg || "保存失败" }, { status: 500 });
  }
}
