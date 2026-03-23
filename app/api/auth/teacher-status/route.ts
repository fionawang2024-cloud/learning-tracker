import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isEmailAuthorizedAsTeacher } from "@/lib/teacherAuthorization";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!token) {
    return NextResponse.json(
      { authorized: false, error: "missing_token" },
      { status: 401 }
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json(
      { authorized: false, error: "server_misconfigured" },
      { status: 500 }
    );
  }

  const supabase = createClient(url, anonKey);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user?.email) {
    return NextResponse.json({ authorized: false, error: "invalid_session" });
  }

  const authorized = isEmailAuthorizedAsTeacher(user.email);
  return NextResponse.json({ authorized });
}
