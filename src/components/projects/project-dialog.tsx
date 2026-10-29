"use client";

import { useEffect, useState } from "react";
import { Button, Dialog, Field, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, useFetch } from "@/hooks/use-api";
import type { Brand, Project } from "@/types/domain";

/** Create or edit a project (name, description, brand). */
export function ProjectDialog({ open, onClose, onSaved, project }: { open: boolean; onClose: () => void; onSaved: (p: Project) => void; project?: Project | null }) {
  const toast = useToast();
  const { data } = useFetch<{ brands: Brand[] }>(open ? "/api/brands" : null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brandId, setBrandId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the form each time it opens
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setBrandId(project?.brandId ?? "");
    setError(null);
  }, [open, project]);

  const save = async () => {
    if (!name.trim()) return setError("Give the project a name.");
    setSaving(true);
    try {
      const body = { name, description, brandId: brandId || null };
      const res = project
        ? await api<{ project: Project }>(`/api/projects/${project.id}`, { method: "PATCH", json: body })
        : await api<{ project: Project }>("/api/projects", { method: "POST", json: body });
      toast(project ? "Project updated" : "Project created");
      onSaved(res.project);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={project ? "Edit project" : "New project"}
      description={project ? undefined : "Projects keep their own critiques, designs, assets and brand context."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {project ? "Save changes" : "Create project"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name" error={error} htmlFor="project-name">
          <Input id="project-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alpine Rail — summer campaign" maxLength={120} />
        </Field>
        <Field label="Description" hint="Objective, audience, anything the agents should know." htmlFor="project-desc">
          <Textarea id="project-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </Field>
        <Field label="Brand profile" hint={data && !data.brands.length ? "No brands yet. You can create one in the Brand Library." : "Rules from this brand are applied automatically."} htmlFor="project-brand">
          <Select id="project-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">No brand</option>
            {data?.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
