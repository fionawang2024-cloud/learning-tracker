const KEY = "pending_display_name";

export function setPendingDisplayName(email, name) {
  if (typeof window === "undefined") return;
  if (email && name) {
    localStorage.setItem(KEY, JSON.stringify({ email: email.trim().toLowerCase(), name: (name || "").trim() }));
  }
}

export function getAndClearPendingDisplayName(email) {
  if (typeof window === "undefined" || !email) return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.email !== email.trim().toLowerCase()) return null;
    localStorage.removeItem(KEY);
    return data.name || null;
  } catch {
    return null;
  }
}
