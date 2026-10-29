"use client";

import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cx } from "./index";

type Kind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: Kind;
  message: string;
}

const Ctx = createContext<(message: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, kind: Kind = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "animate-in pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl border bg-surface px-4 py-3 text-sm shadow-lg",
              t.kind === "error" ? "border-critical/30" : "border-line",
            )}
          >
            {t.kind === "success" && <CheckCircle2 className="mt-0.5 size-4 flex-none text-success" />}
            {t.kind === "error" && <AlertCircle className="mt-0.5 size-4 flex-none text-critical" />}
            {t.kind === "info" && <Info className="mt-0.5 size-4 flex-none text-accent" />}
            <span className="text-ink">{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
