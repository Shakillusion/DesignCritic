"use client";

import { FolderPlus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ConfirmDialog, EmptyState, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, useFetch } from "@/hooks/use-api";
import type { ProjectSummary } from "@/types/domain";
import { ProjectCard } from "./project-card";
import { ProjectDialog } from "./project-dialog";

export function ProjectsView() {
  const router = useRouter();
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<{ projects: ProjectSummary[] }>("/api/projects");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/api/projects/${deleting.id}`, { method: "DELETE" });
      toast(`Deleted “${deleting.name}”`);
      setDeleting(null);
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description="Each project keeps its own brief, brand, critiques, designs and asset library — nothing leaks between them."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New project
          </Button>
        }
      />
      {error && <ErrorNote action={<Button size="sm" onClick={reload}>Retry</Button>}>{error}</ErrorNote>}
      {loading && !data ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-[4/3.9] rounded-2xl" />
          ))}
        </div>
      ) : data && !data.projects.length ? (
        <EmptyState
          icon={<FolderPlus className="size-5" />}
          title="No projects yet"
          description="Create a project to upload designs for critique or to start generating new compositions."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create your first project
            </Button>
          }
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {data?.projects.map((p) => <ProjectCard key={p.id} project={p} onEdit={() => setEditing(p)} onDelete={() => setDeleting(p)} />)}
        </div>
      )}

      <ProjectDialog open={creating} onClose={() => setCreating(false)} onSaved={(p) => router.push(`/projects/${p.id}`)} />
      <ProjectDialog open={Boolean(editing)} project={editing} onClose={() => setEditing(null)} onSaved={() => void reload()} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        loading={busy}
        title="Delete this project?"
        description={
          <>
            This permanently deletes <b className="text-ink">{deleting?.name}</b> with its critiques, designs, versions and downloaded assets. This can’t be undone.
          </>
        }
        confirmText={deleting?.name}
        confirmLabel="Delete project"
      />
    </div>
  );
}
