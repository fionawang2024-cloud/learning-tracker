/**
 * Reading time: UI uses 时:分, DB stores total_time_minutes. Display format: "2时15分".
 */

export function minutesToHoursMinutes(totalMinutes) {
  const m = Math.round(Number(totalMinutes) || 0);
  const hours = Math.floor(m / 60);
  const minutes = m % 60;
  return { hours, minutes };
}

export function hoursMinutesToMinutes(hours, minutes) {
  let h = parseInt(hours, 10) || 0;
  let m = parseInt(minutes, 10) || 0;
  if (m >= 60) {
    h += Math.floor(m / 60);
    m = m % 60;
  }
  return h * 60 + m;
}

export function formatTimeMinutes(totalMinutes) {
  if (totalMinutes == null || totalMinutes === "") return "—";
  const { hours, minutes } = minutesToHoursMinutes(totalMinutes);
  if (hours === 0 && minutes === 0) return "0分";
  if (hours === 0) return `${minutes}分`;
  if (minutes === 0) return `${hours}时`;
  return `${hours}时${minutes}分`;
}
