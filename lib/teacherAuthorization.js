/**
 * Server-side teacher allowlist (source of truth).
 *
 * 1) If env TEACHER_AUTHORIZED_EMAILS is set and non-empty: use ONLY that list
 *    (comma / semicolon / newline separated, case-insensitive).
 * 2) Otherwise: use FALLBACK_AUTHORIZED_TEACHER_EMAILS below (for local dev / small deploys).
 *
 * Do not import this module from client components — use /api/auth/teacher-status instead.
 */

/** Edit here when not using TEACHER_AUTHORIZED_EMAILS env */
const FALLBACK_AUTHORIZED_TEACHER_EMAILS = ["raccoon_fiona@163.com"];

/**
 * @returns {Set<string>} lowercase emails
 */
export function getAuthorizedTeacherEmailSet() {
  const raw = process.env.TEACHER_AUTHORIZED_EMAILS;
  if (raw != null && String(raw).trim() !== "") {
    return new Set(
      String(raw)
        .split(/[,;\n\r]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    );
  }
  return new Set(FALLBACK_AUTHORIZED_TEACHER_EMAILS.map((e) => e.trim().toLowerCase()));
}

/** @param {string | null | undefined} email */
export function isEmailAuthorizedAsTeacher(email) {
  if (!email || typeof email !== "string") return false;
  const set = getAuthorizedTeacherEmailSet();
  return set.has(email.trim().toLowerCase());
}
