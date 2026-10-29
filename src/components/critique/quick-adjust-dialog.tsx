"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Dialog, Field, Input, Segmented } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api } from "@/hooks/use-api";
import type { Critique, Job, StoredFile } from "@/types/domain";

const CROPS = [
  { value: "none", label: "Original" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
] as const;
type Crop = (typeof CROPS)[number]["value"];

/** Raster-only fixes that don't need a rebuild. Saves a new image; the original file is never modified. */
export function QuickAdjustDialog({ open, onClose, file, projectId }: { open: boolean; onClose: () => void; file: StoredFile; projectId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState({ brightness: 1, contrast: 1, saturation: 1 });
  const [crop, setCrop] = useState<Crop>("none");
  const [width, setWidth] = useState<number | "">("");
  const [busy, setBusy] = useState(false);

  const ratio = crop === "none" ? (file.width ?? 1) / (file.height ?? 1) : (() => { const [a, b] = crop.split(":").map(Number); return a / b; })();

  const save = async (critiqueAfter: boolean) => {
    setBusy(true);
    try {
      const { file: out } = await api<{ file: StoredFile }>(`/api/files/${file.id}/adjust`, { method: "POST", json: { ...v, crop, width: width || null } });
      toast("Saved as a new image in the project");
      if (critiqueAfter) {
        const { critique, job } = await api<{ critique: Critique; job: Job }>("/api/critiques", { method: "POST", json: { projectId, fileId: out.id, title: out.originalName.replace(/\.[a-z]+$/i, "") } });
        router.push(`/critiques/${critique.id}?job=${job.id}`);
      } else onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Quick adjust"
      description="Global corrections that work on a flattened image. Saved as a new image; the original stays as it is."
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => save(false)}>
            Save copy
          </Button>
          <Button variant="primary" loading={busy} onClick={() => save(true)}>
            Save and critique
          </Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-[1fr_240px]">
        <div className="canvas-grid flex h-72 items-center justify-center rounded-xl p-3">
          <div className="relative max-h-full max-w-full overflow-hidden shadow-md" style={{ aspectRatio: ratio, height: ratio < 1 ? "100%" : undefined, width: ratio >= 1 ? "100%" : undefined }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- private file preview */}
            <img src={`/api/files/${file.id}?thumb=800`} alt="Preview" className="h-full w-full object-cover" style={{ filter: `brightness(${v.brightness}) contrast(${v.contrast}) saturate(${v.saturation})` }} />
          </div>
        </div>
        <div className="space-y-4">
          {(["brightness", "contrast", "saturation"] as const).map((k) => (
            <Field key={k} label={`${k[0].toUpperCase()}${k.slice(1)} · ${v[k].toFixed(2)}`}>
              <input type="range" min={0.5} max={1.5} step={0.01} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
            </Field>
          ))}
          <Field label="Crop (centred)">
            <Segmented value={crop} onChange={setCrop} options={CROPS.map((c) => ({ value: c.value, label: c.label }))} className="flex-wrap" />
          </Field>
          <Field label="Resize width (px)" hint={`Original ${file.width}×${file.height}. Never enlarges.`}>
            <Input type="number" min={64} max={8000} value={width} placeholder="Keep size" onChange={(e) => setWidth(e.target.value ? Number(e.target.value) : "")} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
