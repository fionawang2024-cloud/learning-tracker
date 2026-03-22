const DEV_VIEW_KEY = "dev_view";

export function isDevModeEnabled() {
  return process.env.NEXT_PUBLIC_DEV_MODE === "true" || process.env.NEXT_PUBLIC_DEV_MODE === true;
}

export function isLocalhost() {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

export function isDevModeActive() {
  return isDevModeEnabled() && isLocalhost();
}

export function getDevView() {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(DEV_VIEW_KEY);
  return v === "teacher" || v === "student" ? v : null;
}

export function setDevView(view) {
  if (typeof window === "undefined") return;
  if (view === "teacher" || view === "student") {
    localStorage.setItem(DEV_VIEW_KEY, view);
  }
}

export function hasDevTeacherAccess() {
  return isDevModeActive() && getDevView() === "teacher";
}
