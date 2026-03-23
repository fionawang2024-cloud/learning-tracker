/** Persisted before magic-link send; read in /auth/callback after redirect. */
const KEY = "xiecun_login_intent";

export const LOGIN_INTENT_STUDENT = "student";
export const LOGIN_INTENT_TEACHER = "teacher";

/** @param {typeof LOGIN_INTENT_STUDENT | typeof LOGIN_INTENT_TEACHER} intent */
export function setLoginIntent(intent) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, intent);
}

/** @returns {string | null} */
export function peekLoginIntent() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY);
}

/** Read and remove (one-shot). */
export function consumeLoginIntent() {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(KEY);
  if (v != null) localStorage.removeItem(KEY);
  return v;
}
