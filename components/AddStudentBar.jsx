"use client";

import { useState } from "react";
import { createStudentIfNotExists } from "@/lib/db";
import { Button } from "@/components/ui/Button";

/**
 * @param {{ onAdded?: (student: object) => void, variant?: "diary" | "statistics" }} props
 */
export default function AddStudentBar({ onAdded, variant = "diary" }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [localErr, setLocalErr] = useState("");
  const [showPanel, setShowPanel] = useState(variant === "statistics");

  async function submit() {
    setHint("");
    setLocalErr("");
    setBusy(true);
    try {
      const { student, created } = await createStudentIfNotExists(name);
      setName("");
      if (created) setHint("添加成功");
      else setHint("该学生已存在");
      onAdded?.(student);
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "flex-1 min-w-[10rem] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-400";

  if (variant === "statistics") {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap w-full sm:w-auto">
        <span className="text-sm text-gray-600 shrink-0">添加学生</span>
        <div className="flex flex-1 flex-col sm:flex-row gap-2 sm:items-center min-w-0">
          <input
            type="text"
            className={inputClass}
            placeholder="学生姓名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void submit()}>
            {busy ? "添加中…" : "添加"}
          </Button>
        </div>
        {localErr && <p className="text-sm text-red-600 sm:w-full">{localErr}</p>}
        {hint && <p className="text-sm text-teal-700 sm:w-full">{hint}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end shrink-0 w-full sm:w-auto">
      {!showPanel ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full sm:w-auto"
          onClick={() => {
            setShowPanel(true);
            setHint("");
            setLocalErr("");
          }}
        >
          添加学生
        </Button>
      ) : (
        <div className="flex flex-col gap-2 w-full sm:min-w-[280px] rounded-xl border border-gray-200 bg-gray-50/80 p-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              className={inputClass}
              placeholder="学生姓名"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
            <div className="flex gap-2 shrink-0">
              <Button type="button" disabled={busy} onClick={() => void submit()}>
                {busy ? "…" : "确认添加"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowPanel(false);
                  setLocalErr("");
                  setHint("");
                }}
              >
                取消
              </Button>
            </div>
          </div>
          {localErr && <p className="text-sm text-red-600">{localErr}</p>}
          {hint && <p className="text-sm text-teal-700">{hint}</p>}
        </div>
      )}
    </div>
  );
}
