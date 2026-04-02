/**
 * Whether the student still needs the one-time display name step after auth.
 * Source of truth: students.display_name in DB.
 *
 * New rows from getOrCreateStudent use email local-part as placeholder; that counts as "not set".
 * If display_name is empty or exactly equals the email prefix, parent must complete /login/finish-student-profile.
 */
export function studentNeedsDisplayNameSetup(email, displayName) {
  const local = (email || "").split("@")[0]?.trim() || "";
  const current = (displayName || "").trim();
  if (!current) return true;
  if (local && current === local) return true;
  return false;
}
