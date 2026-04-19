"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();

  const link = (href, label) => (
    <Link
      href={href}
      className={
        pathname === href || (href !== "/" && pathname?.startsWith(href))
          ? "text-gray-900 font-medium"
          : "text-gray-600 hover:text-gray-900"
      }
    >
      {label}
    </Link>
  );

  return (
    <nav className="sticky top-0 z-50 bg-[var(--card)]/95 backdrop-blur-md border-b border-[var(--card-border)]">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between min-h-14 py-2 gap-3">
          <Link href="/" className="flex flex-col shrink-0">
            <span className="font-medium text-gray-900 text-sm leading-tight">咏梅英文剧社</span>
            <span className="text-xs text-gray-500">阅读 · 日记 · 统计</span>
          </Link>
          <div className="flex items-center gap-6 text-sm">
            {link("/", "记录上传")}
            {link("/statistics", "完成情况统计")}
          </div>
        </div>
      </div>
    </nav>
  );
}
