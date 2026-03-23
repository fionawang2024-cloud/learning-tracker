"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { isDevModeActive, getDevView, setDevView, hasDevTeacherAccess } from "@/lib/devMode";
import { fetchTeacherAuthorization } from "@/lib/teacherAuthClient";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

function navLinkClass(active) {
  return `flex items-center justify-center min-h-11 rounded-xl text-sm font-medium transition duration-200 px-3 ${
    active ? "bg-teal-100 text-teal-900" : "bg-gray-50 text-gray-700 hover:bg-gray-100"
  }`;
}

export default function Navbar() {
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [devView, setDevViewState] = useState(null);
  const [devModeActive, setDevModeActive] = useState(false);
  const [teacherAuthorized, setTeacherAuthorized] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u ?? null);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setTeacherAuthorized(false);
      return;
    }
    if (hasDevTeacherAccess()) {
      setTeacherAuthorized(true);
      return;
    }
    fetchTeacherAuthorization().then(({ authorized }) => {
      setTeacherAuthorized(!!authorized);
    });
  }, [user]);

  useEffect(() => {
    setDevModeActive(isDevModeActive());
    setDevViewState(getDevView() || "student");
  }, [pathname]);

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  function handleDevViewToggle() {
    const next = devView === "teacher" ? "student" : "teacher";
    setDevView(next);
    setDevViewState(next);
    window.location.reload();
  }

  const showTeacherLink = teacherAuthorized || hasDevTeacherAccess();
  const isLoginPage = pathname === "/login";

  return (
    <nav className="sticky top-0 z-50 bg-[var(--card)]/95 backdrop-blur-md border-b border-[var(--card-border)]">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 lg:px-8">
        {/* —— Desktop (sm+) —— */}
        <div className="hidden sm:flex items-center justify-between min-h-16 py-2 gap-4">
          <div className="flex items-center gap-6 min-w-0">
            <Link href="/" className="flex flex-col shrink-0">
              <span className="font-medium text-gray-900 text-sm leading-tight">
                谢村咏梅英文剧社英语学习系统
              </span>
              <span className="text-xs text-gray-500">学习记录</span>
            </Link>
            <div className="flex items-center gap-3 flex-wrap">
              <Link
                href="/"
                className={`text-sm font-medium transition duration-200 ${
                  pathname === "/" ? "text-gray-900" : "text-gray-500 hover:text-gray-900"
                }`}
              >
                首页
              </Link>
              {!loading && user && (
                <>
                  <Link
                    href="/student"
                    className={`text-sm font-medium transition duration-200 ${
                      pathname === "/student" ? "text-gray-900" : "text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    学生端
                  </Link>
                  <Link
                    href="/student/history"
                    className={`text-sm font-medium transition duration-200 ${
                      pathname === "/student/history" ? "text-gray-900" : "text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    历史学习记录
                  </Link>
                  {showTeacherLink && (
                    <Link
                      href="/teacher"
                      className={`text-sm font-medium transition duration-200 ${
                        pathname?.startsWith("/teacher") ? "text-gray-900" : "text-gray-500 hover:text-gray-900"
                      }`}
                    >
                      教师端
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
            {devModeActive && (
              <>
                <Badge variant="warning">开发模式</Badge>
                <button
                  type="button"
                  onClick={handleDevViewToggle}
                  className="text-xs text-gray-600 hover:text-gray-900 transition duration-200 whitespace-nowrap"
                >
                  {devView === "teacher" ? "切换到学生视角" : "切换到教师视角"}
                </button>
              </>
            )}
            {loading ? (
              <span className="text-sm text-gray-400">加载中…</span>
            ) : user ? (
              <>
                <Badge variant={showTeacherLink ? "teacher" : "student"}>
                  {showTeacherLink ? "教师" : "学生"}
                </Badge>
                <span
                  className="text-xs text-gray-500 max-w-[200px] truncate hidden md:inline"
                  title={user.email}
                >
                  {user.email}
                </span>
                <Button variant="ghost" onClick={handleLogout} className="!px-3 !py-2 text-sm">
                  退出登录
                </Button>
              </>
            ) : !isLoginPage ? (
              <Link href="/login">
                <Button variant="primary" className="!py-2 text-sm">
                  去登录
                </Button>
              </Link>
            ) : null}
          </div>
        </div>

        {/* —— Mobile (only below sm) —— vertical stack, no crowded single row —— */}
        <div className="flex flex-col gap-3 py-3 sm:hidden">
          <div className="flex items-start justify-between gap-3">
            <Link href="/" className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-900 leading-snug">
                谢村咏梅英文剧社
              </span>
              <span className="block text-xs text-gray-500 mt-0.5">英语学习系统 · 学习记录</span>
            </Link>
            {!loading && user ? (
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <Badge variant={showTeacherLink ? "teacher" : "student"} className="text-xs">
                  {showTeacherLink ? "教师" : "学生"}
                </Badge>
                <Button
                  variant="ghost"
                  onClick={handleLogout}
                  className="!px-2 !py-1.5 !text-xs h-auto min-h-0"
                >
                  退出
                </Button>
              </div>
            ) : !loading && !isLoginPage ? (
              <Link href="/login" className="shrink-0">
                <Button variant="primary" className="!px-3 !py-2 text-sm">
                  去登录
                </Button>
              </Link>
            ) : null}
          </div>

          {!loading && user && (
            <p className="text-[11px] text-gray-500 break-all leading-snug pr-1">{user.email}</p>
          )}

          {devModeActive && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="warning">开发模式</Badge>
              <button
                type="button"
                onClick={handleDevViewToggle}
                className="text-xs text-teal-800 underline underline-offset-2"
              >
                {devView === "teacher" ? "切到学生视角" : "切到教师视角"}
              </button>
            </div>
          )}

          {!loading && user && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Link href="/" className={navLinkClass(pathname === "/")}>
                首页
              </Link>
              <Link href="/student" className={navLinkClass(pathname === "/student")}>
                学生端
              </Link>
              <Link
                href="/student/history"
                className={`col-span-2 min-h-[48px] flex items-center justify-center rounded-xl text-sm font-semibold transition-colors px-3 ${
                  pathname === "/student/history"
                    ? "bg-teal-600 text-white shadow-md ring-2 ring-teal-300 ring-offset-1"
                    : "bg-teal-500 text-white shadow-sm hover:bg-teal-600 active:scale-[0.99]"
                }`}
              >
                历史学习记录
              </Link>
              {showTeacherLink && (
                <Link
                  href="/teacher"
                  className={`col-span-2 ${navLinkClass(pathname?.startsWith("/teacher"))}`}
                >
                  教师端
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
