"use client";

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Loader2, X } from "lucide-react";
import Link from "next/link";
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

/** Class joiner where later Tailwind utilities override earlier ones (so `className` props win). */
export const cx = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/* ── Button ─────────────────────────────────────────────── */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover shadow-sm",
  secondary: "bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-2 shadow-sm",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  subtle: "bg-surface-2 text-ink hover:bg-surface-3",
  danger: "bg-critical text-white hover:opacity-90 shadow-sm",
};
const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-9 px-3.5 text-sm gap-2 rounded-[10px]",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors duration-150 select-none disabled:opacity-50 disabled:pointer-events-none",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ href, variant = "secondary", size = "md", icon, className, children }: { href: string; variant?: Variant; size?: Size; icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx("inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors duration-150", VARIANT[variant], SIZE[size], className)}>
      {icon}
      {children}
    </Link>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx("inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ── Form controls ──────────────────────────────────────── */

const control =
  "w-full rounded-[10px] border border-line bg-surface px-3 text-sm text-ink placeholder:text-subtle shadow-sm transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15 disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(control, "h-9", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(control, "py-2 leading-relaxed", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(control, "h-9 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239a938b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children, className, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-critical">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; hint?: string }[]; className?: string }) {
  return (
    <div role="radiogroup" className={cx("inline-flex rounded-[10px] border border-line bg-surface-2 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-8 rounded-lg px-3 text-[13px] font-medium transition-all",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-6">
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-5 w-9 flex-none rounded-full transition-colors", checked ? "bg-accent" : "bg-surface-3")}
      >
        <span className={cx("absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
    </label>
  );
}

/* ── Display ────────────────────────────────────────────── */

type Tone = "neutral" | "accent" | "critical" | "major" | "minor" | "success";
const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  accent: "bg-accent-soft text-accent border-accent-line",
  critical: "bg-critical-soft text-critical border-transparent",
  major: "bg-major-soft text-major border-transparent",
  minor: "bg-minor-soft text-minor border-transparent",
  success: "bg-success-soft text-success border-transparent",
};

export function Badge({ tone = "neutral", children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cx("inline-flex h-[22px] items-center gap-1 rounded-md border px-1.5 text-[11.5px] font-medium whitespace-nowrap", TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Panel({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={cx("rounded-2xl border border-line bg-surface shadow-sm", padded && "p-5", className)}>{children}</div>;
}

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-3 flex items-center justify-between gap-4", className)}>
      <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-2xl">
        {eyebrow && <p className="mb-2 text-[13px] font-medium text-accent">{eyebrow}</p>}
        <h1 className="font-display text-[32px] leading-[1.1] font-semibold text-ink">{title}</h1>
        {description && <p className="mt-2.5 text-[15px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent">{icon}</div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-4 animate-spin text-muted", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded-lg", className)} />;
}

export function ErrorNote({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-4 rounded-xl border border-critical/20 bg-critical-soft px-4 py-3 text-sm text-critical">
      <div>{children}</div>
      {action}
    </div>
  );
}

/* ── Dialog ─────────────────────────────────────────────── */

export function Dialog({ open, onClose, title, description, children, footer, width = "max-w-md" }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children?: ReactNode; footer?: ReactNode; width?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal focuses the close button; move focus to the first field instead.
      d.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx("m-auto w-[calc(100%-32px)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-ink/30 backdrop:backdrop-blur-[2px]", width)}
    >
      {open && (
        <div className="animate-fade">
          <div className="flex items-start justify-between gap-4 px-6 pt-5">
            <div>
              <h2 className="text-[17px] font-semibold">{title}</h2>
              {description && <div className="mt-1 text-sm text-muted">{description}</div>}
            </div>
            <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1">
              <X className="size-4" />
            </IconButton>
          </div>
          {children && <div className="px-6 pt-4">{children}</div>}
          <div className="flex justify-end gap-2 px-6 pt-5 pb-5">{footer}</div>
        </div>
      )}
    </dialog>
  );
}

/** Destructive confirmation. With `confirmText`, the user must type it to enable the button. */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Delete", confirmText, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; description: ReactNode; confirmLabel?: string; confirmText?: string; loading?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={loading}
            onClick={() => {
              if (confirmText && inputRef.current?.value.trim() !== confirmText) {
                inputRef.current?.focus();
                inputRef.current?.setCustomValidity(`Type “${confirmText}” to confirm`);
                inputRef.current?.reportValidity();
                return;
              }
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {confirmText && (
        <Field label={`Type “${confirmText}” to confirm`}>
          <Input ref={inputRef} autoFocus onInput={(e) => e.currentTarget.setCustomValidity("")} />
        </Field>
      )}
    </Dialog>
  );
}

/* ── Score ring ─────────────────────────────────────────── */

export function scoreTone(score: number | null): Tone {
  if (score === null) return "neutral";
  if (score >= 80) return "success";
  if (score >= 65) return "accent";
  if (score >= 50) return "major";
  return "critical";
}

export function ScoreRing({ score, size = 112, stroke = 9, label }: { score: number | null; size?: number; stroke?: number; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const color = { success: "var(--success)", accent: "var(--accent)", major: "var(--major)", critical: "var(--critical)", neutral: "var(--subtle)", minor: "var(--minor)" }[scoreTone(score)];
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset .8s cubic-bezier(.2,.7,.2,1)" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-semibold text-ink tabular-nums" style={{ fontSize: size * 0.32, lineHeight: 1 }}>
          {score ?? "–"}
        </span>
        {label && <span className="mt-1 text-[11px] font-medium text-muted">{label}</span>}
      </div>
    </div>
  );
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
