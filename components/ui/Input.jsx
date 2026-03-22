export function Input({ className = "", ...props }) {
  return (
    <input
      className={`rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-[var(--primary)] transition duration-200 w-full ${className}`}
      {...props}
    />
  );
}
