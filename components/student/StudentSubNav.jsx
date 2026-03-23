"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Mobile-first segmented nav for /student and /student/history.
 * Keeps「历史学习记录」always visible and tappable in the student area.
 */
export default function StudentSubNav() {
  const pathname = usePathname();
  const onUpload = pathname === "/student";
  const onHistory = pathname?.startsWith("/student/history");

  const base =
    "flex-1 min-h-[52px] sm:min-h-11 flex items-center justify-center rounded-xl text-sm font-semibold transition-all px-2 text-center leading-snug";

  return (
    <nav
      className="w-full max-w-lg mx-auto mb-5 sm:mb-6"
      aria-label="学生专区"
    >
      <div className="flex rounded-2xl border-2 border-teal-200/80 bg-teal-50/50 p-1.5 gap-1.5 shadow-sm">
        <Link
          href="/student"
          className={`${base} ${
            onUpload
              ? "bg-white text-teal-900 shadow-sm ring-1 ring-teal-100"
              : "text-teal-800/85 hover:bg-white/70 active:scale-[0.99]"
          }`}
        >
          上传作业
        </Link>
        <Link
          href="/student/history"
          className={`${base} ${
            onHistory
              ? "bg-white text-teal-900 shadow-sm ring-1 ring-teal-100"
              : "text-teal-800/85 hover:bg-white/70 active:scale-[0.99]"
          }`}
        >
          历史学习记录
        </Link>
      </div>
    </nav>
  );
}
