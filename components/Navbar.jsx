"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { isTeacherEmail } from "@/lib/constants";
import { isDevModeActive, getDevView, setDevView, hasDevTeacherAccess } from "@/lib/devMode";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export default function Navbar() {
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [devView, setDevViewState] = useState(null);
  const [devModeActive, setDevModeActive] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u ?? null);
      setLoading(false);
    });
  }, []);

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

  const isTeacher = user && isTeacherEmail(user.email);
  const showTeacherLink = isTeacher || hasDevTeacherAccess();
  const isLoginPage = pathname === "/login";

  return (
    <nav className="sticky top-0 z-50 bg-[var(--card)]/90 backdrop-blur-md border-b border-[var(--card-border)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex flex-col">
              <span className="font-medium text-gray-900">谢村咏梅英文剧社英语学习系统</span>
              <span className="text-xs text-gray-500">学习记录</span>
            </Link>
            <div className="hidden sm:flex items-center gap-4">
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
          <div className="flex items-center gap-4">
            {devModeActive && (
              <>
                <Badge variant="warning">开发模式</Badge>
                <button
                  type="button"
                  onClick={handleDevViewToggle}
                  className="text-xs text-gray-600 hover:text-gray-900 transition duration-200"
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
                <span className="text-xs text-gray-500 max-w-[140px] truncate" title={user.email}>
                  当前登录：{user.email}
                </span>
                <Button variant="ghost" onClick={handleLogout}>
                  退出登录
                </Button>
              </>
            ) : !isLoginPage ? (
                <Link href="/login">
                  <Button variant="primary">去登录</Button>
                </Link>
              ) : null}
          </div>
        </div>
      </div>
    </nav>
  );
}
