export function Table({ children, className = "" }) {
  return (
    <div className={`rounded-2xl overflow-hidden border border-gray-100 ${className}`}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function TableHeader({ children }) {
  return (
    <thead>
      <tr className="bg-gray-50 border-b border-gray-100">{children}</tr>
    </thead>
  );
}

export function TableHead({ children, className = "" }) {
  return (
    <th className={`text-left font-medium text-gray-600 px-4 py-3 ${className}`}>
      {children}
    </th>
  );
}

export function TableBody({ children }) {
  return <tbody>{children}</tbody>;
}

export function TableRow({ children, className = "" }) {
  return (
    <tr className={`border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition-colors duration-200 ${className}`}>
      {children}
    </tr>
  );
}

export function TableCell({ children, className = "" }) {
  return <td className={`px-4 py-3 text-gray-900 ${className}`}>{children}</td>;
}
