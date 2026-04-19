/**
 * 标准 <table>；表头与内容共用同一 table，通过 table-fixed + 每列 th/td 成对宽度保证对齐。
 * TableHeader 只输出 <thead>，内层请用一行 <TableRow> 包裹 <TableHead>。
 */

export function Table({ children, className = "", tableClassName = "" }) {
  return (
    <div className={`w-full min-w-0 ${className}`}>
      <table
        className={`w-full border-collapse text-left align-top text-sm text-gray-900 ${tableClassName}`}
      >
        {children}
      </table>
    </div>
  );
}

/** 只包裹 <thead>；子节点应为 <TableRow>，行内为 <TableHead>… */
export function TableHeader({ children }) {
  return <thead>{children}</thead>;
}

export function TableHead({ children, className = "", scope = "col" }) {
  return (
    <th
      scope={scope}
      className={`align-top bg-gray-100 font-medium text-gray-800 border-b border-gray-200 px-3 py-3 text-sm ${className}`}
    >
      {children}
    </th>
  );
}

export function TableBody({ children }) {
  return <tbody>{children}</tbody>;
}

export function TableRow({ children, className = "", header = false }) {
  return (
    <tr
      className={`border-b border-gray-100 ${header ? "" : "transition-colors hover:bg-gray-50/70"} ${className}`}
    >
      {children}
    </tr>
  );
}

export function TableCell({ children, className = "" }) {
  return <td className={`align-top px-3 py-3 text-sm text-gray-900 ${className}`}>{children}</td>;
}
