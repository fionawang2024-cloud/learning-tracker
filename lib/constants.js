export const TEACHER_EMAILS = ["raccoon_fiona@163.com"];

/** 本学期默认起始日，可集中修改 */
export const SEMESTER_START = "2026-02-01";

export function isTeacherEmail(email) {
  if (!email) return false;
  return TEACHER_EMAILS.includes(email.trim().toLowerCase());
}
