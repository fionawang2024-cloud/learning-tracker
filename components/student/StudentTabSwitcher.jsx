"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 学生端唯一分段切换：上传作业 | 历史学习记录（与全局顶栏重复导航已移除）
 */
export default function StudentTabSwitcher() {
  const pathname = usePathname();
  const onUpload = pathname === "/student";
  const onHistory = pathname?.startsWith("/student/history");

  const tab =
    "flex-1 min-h-[48px] sm:min-h-10 flex items-center justify-center rounded-xl text-sm font-semibold transition-all px-2 text-center leading-snug";

  return (
    <nav
      className="w-full max-w-lg mx-auto mb-4 sm:mb-5"
      aria-label="学生页面切换"
    >
      <div className="flex rounded-2xl border border-teal-200/90 bg-teal-50/60 p-1 gap-1 shadow-sm">
        <Link
          href="/student"
          className={`${tab} ${
            onUpload
              ? "bg-white text-teal-900 shadow-sm ring-1 ring-teal-100/80"
              : "text-teal-800/90 hover:bg-white/70 active:scale-[0.99]"
          }`}
        >
          上传作业
        </Link>
        <Link
          href="/student/history"
          className={`${tab} ${
            onHistory
              ? "bg-white text-teal-900 shadow-sm ring-1 ring-teal-100/80"
              : "text-teal-800/90 hover:bg-white/70 active:scale-[0.99]"
          }`}
        >
          历史学习记录
        </Link>
      </div>
    </nav>
  );
}
