const variants = {
  student: "bg-teal-100 text-teal-800",
  teacher: "bg-[var(--accent-soft)] text-purple-800",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
};

export function Badge({ children, variant = "student", className = "" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variants[variant] || variants.student} ${className}`}
    >
      {children}
    </span>
  );
}
