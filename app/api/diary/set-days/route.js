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
    const body = await request.json();
    const student_id = body.student_id;
    const diary_days = Array.isArray(body.diary_days) ? body.diary_days.map((d) => String(d).slice(0, 10)) : [];
    if (!student_id) {
      return Response.json({ ok: false, error: "student_id 必填" }, { status: 400 });
    }

    const supabase = serverSupabase();
    const today = new Date().toISOString().slice(0, 10);
    const sorted = Array.from(new Set(diary_days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))).sort();

    console.log("[diary/set-days] table=diary_records | op=upsert_latest_row", {
      student_id,
      diary_days_count: sorted.length,
    });

    const { data: latest, error: findErr } = await supabase
      .from("diary_records")
      .select("id")
      .eq("student_id", student_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findErr) {
      console.error("[diary/set-days] select failed", {
        message: findErr?.message,
        details: findErr?.details,
        hint: findErr?.hint,
        code: findErr?.code,
      });
      return Response.json({ ok: false, error: `diary_records select failed: ${findErr.message}` }, { status: 500 });
    }

    if (latest?.id) {
      const { error: upErr } = await supabase
        .from("diary_records")
        .update({
          diary_days: sorted,
          upload_date: sorted.length ? sorted[sorted.length - 1] : today,
        })
        .eq("id", latest.id);
      if (upErr) {
        console.error("[diary/set-days] update failed", upErr);
        return Response.json({ ok: false, error: `diary_records update failed: ${upErr.message}` }, { status: 500 });
      }
    } else {
      const { error: insErr } = await supabase.from("diary_records").insert({
        student_id,
        diary_days: sorted,
        upload_date: sorted.length ? sorted[0] : today,
        corrected_text: "teacher_row_save",
      });
      if (insErr) {
        console.error("[diary/set-days] insert failed", insErr);
        return Response.json({ ok: false, error: `diary_records insert failed: ${insErr.message}` }, { status: 500 });
      }
    }

    return Response.json({ ok: true });
  } catch (e) {
    console.error("[diary/set-days]", e);
    return Response.json({ ok: false, error: e?.message || "保存失败" }, { status: 500 });
  }
}
