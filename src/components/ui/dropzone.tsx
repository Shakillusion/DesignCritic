"use client";

import { ImageUp } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { cx } from "./index";

export function Dropzone({ onFile, accept, children, className, disabled, hint }: { onFile: (f: File) => void; accept: string; children?: ReactNode; className?: string; disabled?: boolean; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !disabled && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f && !disabled) onFile(f);
      }}
      className={cx(
        "relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition-colors",
        over ? "border-accent bg-accent-soft/60" : "border-line-strong bg-surface hover:border-accent/50 hover:bg-surface-2/50",
        disabled && "pointer-events-none opacity-60",
        className,
      )}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      {children ?? (
        <div className="px-6 py-10">
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <ImageUp className="size-5" />
          </div>
          <div className="text-sm font-medium text-ink">Drop a file or click to browse</div>
          {hint && <div className="mt-1 text-[12.5px] text-muted">{hint}</div>}
        </div>
      )}
    </div>
  );
}
