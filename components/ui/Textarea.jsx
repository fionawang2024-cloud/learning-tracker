export function Textarea({ className = "", ...props }) {
  return (
    <textarea
      className={`rounded-2xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-transparent transition duration-200 w-full resize-y ${className}`}
      {...props}
    />
  );
}
