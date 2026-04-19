import { createClient } from "@supabase/supabase-js";
import { supabaseNoAuthClientOptions } from "@/lib/supabaseClient";
import { localYMD } from "@/lib/dateRangeUtils";
import { filterActivityRowsForSemesterWindow } from "@/lib/semesterAwardStats";
import { buildSemesterReportBuffer } from "@/lib/semesterReportExcel";

function serverSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("缺少 Supabase 环境变量");
  }
  return createClient(url, key, supabaseNoAuthClientOptions);
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const semesterId = String(searchParams.get("semesterId") || "").trim();
    if (!semesterId) {
      return Response.json({ ok: false, error: "缺少 semesterId" }, { status: 400 });
    }

    const supabase = serverSupabase();
    const { data: semesterRow, error: semErr } = await supabase.from("semesters").select("*").eq("id", semesterId).maybeSingle();
    if (semErr) throw semErr;
    if (!semesterRow?.id) {
      return Response.json({ ok: false, error: "未找到学期" }, { status: 404 });
    }

    const [{ data: students }, { data: readings }, { data: diaries }, { data: speaking }] = await Promise.all([
      supabase.from("students").select("*").order("display_name"),
      supabase.from("reading_records").select("*").order("created_at", { ascending: false }).limit(12000),
      supabase.from("diary_records").select("*").order("created_at", { ascending: false }).limit(12000),
      supabase.from("speaking_scores").select("*").order("created_at", { ascending: false }).limit(12000),
    ]);

    const rangeStartYmd = localYMD(new Date(semesterRow.started_at));
    const rangeEndYmd = semesterRow.ended_at ? localYMD(new Date(semesterRow.ended_at)) : localYMD();
    const semWin = {
      startedAt: semesterRow.started_at,
      endedAt: semesterRow.ended_at || null,
      rangeStartYmd,
      rangeEndYmd,
    };
    const { readings: rf, diaries: df, speaking: sf } = filterActivityRowsForSemesterWindow(
      readings || [],
      diaries || [],
      speaking || [],
      semWin
    );
    const sidSet = new Set();
    for (const r of [...rf, ...df, ...sf]) if (r.student_id) sidSet.add(r.student_id);
    const roster = (students || []).filter((s) => s.semester_id === semesterRow.id || sidSet.has(s.id));

    const buf = buildSemesterReportBuffer({
      semesterRow,
      students: roster,
      readings: readings || [],
      diaries: diaries || [],
      speaking: speaking || [],
    });

    const semStartYmd = localYMD(new Date(semesterRow.started_at));
    const semEndYmd = semesterRow.ended_at ? localYMD(new Date(semesterRow.ended_at)) : localYMD();
    const fname = `semester-report-${semStartYmd}_to_${semEndYmd}.xlsx`;

    return new Response(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fname}"; filename*=UTF-8''${encodeURIComponent(fname)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[api/export-semester-report]", e);
    return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
