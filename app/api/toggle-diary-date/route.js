import { createClient } from "@supabase/supabase-js";
import { supabaseNoAuthClientOptions } from "@/lib/supabaseClient";

function serverSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  return createClient(url, key, supabaseNoAuthClientOptions);
}

export async function POST(request) {
  try {
    const { student_id, completed_date } = await request.json();
    if (!student_id || !completed_date) {
      return Response.json({ error: "student_id 与 completed_date 必填" }, { status: 400 });
    }
    const supabase = serverSupabase();

    const { data: exists, error: findErr } = await supabase
      .from("diary_records")
      .select("id, diary_days")
      .eq("student_id", student_id)
      .contains("diary_days", [completed_date])
      .limit(1)
      .maybeSingle();
    if (findErr) throw findErr;

    if (exists) {
      const next = (exists.diary_days || []).filter((d) => d !== completed_date);
      const { error: upErr } = await supabase
        .from("diary_records")
        .update({ diary_days: next })
        .eq("id", exists.id);
      if (upErr) throw upErr;
      return Response.json({ ok: true, checked: false });
    }

    const { data: latest, error: latestErr } = await supabase
      .from("diary_records")
      .select("id, diary_days")
      .eq("student_id", student_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr) throw latestErr;

    if (latest) {
      const set = new Set([...(latest.diary_days || []), completed_date]);
      const next = Array.from(set).sort();
      const { error: upErr } = await supabase
        .from("diary_records")
        .update({ diary_days: next, upload_date: completed_date })
        .eq("id", latest.id);
      if (upErr) throw upErr;
    } else {
      const { error: createErr } = await supabase
        .from("diary_records")
        .insert({
          student_id,
          upload_date: completed_date,
          corrected_text: "manual_diary_checked",
          diary_days: [completed_date],
        });
      if (createErr) throw createErr;
    }

    return Response.json({ ok: true, checked: true });
  } catch (e) {
    console.error("[toggle-diary-date]", e);
    return Response.json({ ok: false, error: e?.message || "操作失败" }, { status: 500 });
  }
}
