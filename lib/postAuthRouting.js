"use client";

import { getOrCreateStudent } from "@/lib/db";
import { fetchTeacherAuthorization } from "@/lib/teacherAuthClient";
import { hasDevTeacherAccess } from "@/lib/devMode";
import { studentNeedsDisplayNameSetup } from "@/lib/studentProfileSetup";

/**
 * After a valid session exists: send user to teacher dashboard, student home,
 * or first-login name completion. Used by /auth/callback and /login (auto-login).
 *
 * @param {import("@supabase/supabase-js").User} user
 * @param {{ replace: (path: string) => void }} router
 */
export async function routeAfterAuthSession(user, router) {
  if (!user?.id) return;

  if (hasDevTeacherAccess()) {
    router.replace("/teacher");
    return;
  }

  try {
    const { authorized } = await fetchTeacherAuthorization();
    if (authorized) {
      router.replace("/teacher");
      return;
    }
  } catch {
    /* fall through to student routing */
  }

  let student;
  try {
    student = await getOrCreateStudent(user);
  } catch (e) {
    console.error("[postAuthRouting] getOrCreateStudent", e);
    router.replace("/student");
    return;
  }

  if (!student) {
    router.replace("/login");
    return;
  }

  if (studentNeedsDisplayNameSetup(user.email, student.display_name)) {
    router.replace("/login/finish-student-profile");
    return;
  }

  router.replace("/student");
}
