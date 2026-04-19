import { createClient } from "@supabase/supabase-js";
import { supabaseNoAuthClientOptions } from "@/lib/supabaseClient";
import { runStartNewSemester } from "@/lib/semesterLifecycle";

function serverSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("缺少 Supabase 环境变量");
  }
  return createClient(url, key, supabaseNoAuthClientOptions);
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const nextTermLabel = body?.nextTermLabel;
    const nextStartedAtYmd = body?.nextStartedAtYmd;
    const supabase = serverSupabase();
    const result = await runStartNewSemester(supabase, { nextTermLabel, nextStartedAtYmd });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[api/semester/start-new]", e);
    return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
