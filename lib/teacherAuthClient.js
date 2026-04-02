"use client";

import { getSupabaseClient } from "@/lib/supabaseClient";

/**
 * Ask server whether the current session’s user is on the teacher allowlist.
 * @returns {Promise<{ authorized: boolean; error?: string }>}
 */
export async function fetchTeacherAuthorization() {
  const { data: { session } } = await getSupabaseClient().auth.getSession();
  if (!session?.access_token) {
    return { authorized: false, error: "no_session" };
  }
  try {
    const res = await fetch("/api/auth/teacher-status", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return { authorized: false, error: `http_${res.status}` };
    }
    const data = await res.json();
    return { authorized: !!data.authorized };
  } catch (e) {
    return { authorized: false, error: e?.message || "fetch_failed" };
  }
}
