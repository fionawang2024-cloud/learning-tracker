import { randomUUID } from "crypto";
import { upsertSpeakingScoreForClassDate } from "@/lib/db";
import { parseSpeakingBulkText } from "@/lib/speakingBulkParse";
import { fetchOpenSemesterRow } from "@/lib/semesterAwardStats";
import { createClient } from "@supabase/supabase-js";
import { supabaseNoAuthClientOptions } from "@/lib/supabaseClient";

function serverSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  return createClient(url, key, supabaseNoAuthClientOptions);
}

function localDateYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function findOrCreateStudentByName(supabase, name) {
  const cleaned = String(name || "").trim();
  if (!cleaned) throw new Error("姓名为空");

  const { data: byDisplay, error: e1 } = await supabase
    .from("students")
    .select("*")
    .eq("display_name", cleaned)
    .maybeSingle();
  if (e1) throw e1;
  if (byDisplay) return byDisplay;

  const { data: byName, error: e2 } = await supabase.from("students").select("*").eq("name", cleaned).maybeSingle();
  if (!e2 && byName) return byName;
  if (e2 && e2.code !== "PGRST116") {
    const msg = String(e2.message || "").toLowerCase();
    const ignorable = msg.includes("column") && msg.includes("name");
    if (!ignorable) throw e2;
  }

  const fakeMail = `speaking-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@manual.local`;
  const baseRow = {
    display_name: cleaned,
    email: fakeMail,
    auth_user_id: randomUUID(),
    ...(semesterId ? { semester_id: semesterId } : {}),
  };

  let ins = await supabase.from("students").insert({ ...baseRow, name: cleaned }).select("*").single();
  if (ins.error) {
    ins = await supabase.from("students").insert(baseRow).select("*").single();
  }
  if (ins.error) throw ins.error;
  return ins.data;
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { rawText, scoreDate: scoreDateRaw } = body;
    const text = String(rawText ?? "");
    if (!text.trim()) {
      return Response.json({ ok: false, error: "请输入内容" }, { status: 400 });
    }

    const { pairs, failed: parseFailed } = parseSpeakingBulkText(text);
    if (pairs.length === 0 && parseFailed.length === 0) {
      return Response.json({ ok: false, error: "未解析到任何「姓名：分数」或「姓名：请假」" }, { status: 400 });
    }

    const supabase = serverSupabase();
    const { data: openSemRow } = await fetchOpenSemesterRow(supabase);
    const currentSemesterId = openSemRow?.id ?? null;
    let scoreDate = String(scoreDateRaw ?? "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scoreDate)) {
      scoreDate = localDateYMD();
    }
    const saved = [];
    const errors = [...parseFailed];

    for (const entry of pairs) {
      const { name } = entry;
      try {
        const student = await findOrCreateStudentByName(supabase, name, currentSemesterId);
        if (entry.kind === "leave") {
          await upsertSpeakingScoreForClassDate(student.id, scoreDate, "leave");
          saved.push({ name, kind: "leave", student_id: student.id });
        } else {
          await upsertSpeakingScoreForClassDate(student.id, scoreDate, entry.score);
          saved.push({ name, score: entry.score, student_id: student.id });
        }
      } catch (e) {
        console.error("[speaking/bulk-ingest] row failed", name, e);
        errors.push(`${name}：保存失败 — ${e?.message || String(e)}`);
      }
    }

    return Response.json({
      ok: true,
      saved,
      errors,
      score_date: scoreDate,
    });
  } catch (e) {
    console.error("[speaking/bulk-ingest]", e);
    return Response.json({ ok: false, error: e?.message || "录入失败" }, { status: 500 });
  }
}
