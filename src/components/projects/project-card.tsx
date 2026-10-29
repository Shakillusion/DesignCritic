"use client";

import { FolderOpen, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cx, timeAgo } from "@/components/ui";
import type { ProjectSummary } from "@/types/domain";

export function ProjectCard({ project, onEdit, onDelete }: { project: ProjectSummary; onEdit?: () => void; onDelete?: () => void }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const stats = [
    project.critiqueCount && `${project.critiqueCount} critique${project.critiqueCount === 1 ? "" : "s"}`,
    project.designCount && `${project.designCount} design${project.designCount === 1 ? "" : "s"}`,
    project.assetCount && `${project.assetCount} asset${project.assetCount === 1 ? "" : "s"}`,
  ].filter(Boolean);

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md">
      <Link href={`/projects/${project.id}`} className="block">
        <div className="canvas-grid relative aspect-[4/3] overflow-hidden border-b border-line">
          {project.coverFileId ? (
            // eslint-disable-next-line @next/next/no-img-element -- private files served by our own route
            <img src={`/api/files/${project.coverFileId}?thumb=640`} alt="" className="absolute inset-0 m-auto max-h-[82%] max-w-[82%] rounded-md object-contain shadow-md transition-transform duration-300 group-hover:scale-[1.02]" />
          ) : (
            <div className="flex h-full items-center justify-center text-subtle">
              <FolderOpen className="size-7" strokeWidth={1.5} />
            </div>
          )}
        </div>
        <div className="p-4">
          <div className="truncate pr-8 text-[15px] font-semibold text-ink">{project.name}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">
            {project.brandName && (
              <>
                <span className="truncate font-medium text-ink-2">{project.brandName}</span>
                <span className="text-subtle">·</span>
              </>
            )}
            <span>{timeAgo(project.updatedAt)}</span>
          </div>
          <div className="mt-3 text-[12px] text-subtle">{stats.length ? stats.join(" · ") : "Empty project"}</div>
        </div>
      </Link>
      {(onEdit || onDelete) && (
        <div ref={ref} className="absolute right-3 bottom-[70px]">
          <button
            aria-label="Project actions"
            onClick={() => setMenu((m) => !m)}
            className={cx("flex size-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink", menu ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100")}
          >
            <MoreHorizontal className="size-4" />
          </button>
          {menu && (
            <div className="animate-in absolute right-0 bottom-9 z-10 w-40 rounded-xl border border-line bg-surface p-1 shadow-lg">
              {onEdit && (
                <button onClick={() => (setMenu(false), onEdit())} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-2">
                  <Pencil className="size-3.5 text-muted" /> Rename / edit
                </button>
              )}
              {onDelete && (
                <button onClick={() => (setMenu(false), onDelete())} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-critical hover:bg-critical-soft">
                  <Trash2 className="size-3.5" /> Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
