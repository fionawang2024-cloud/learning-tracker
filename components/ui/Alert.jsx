const variants = {
  info: "bg-teal-50 border-teal-200 text-teal-800",
  success: "bg-emerald-50 border-emerald-200 text-emerald-800",
  error: "bg-red-50 border-red-200 text-red-800",
  warning: "bg-amber-50 border-amber-200 text-amber-800",
};

export function Alert({ children, variant = "info", className = "" }) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm ${variants[variant] || variants.info} ${className}`}
    >
      {children}
    </div>
  );
}
