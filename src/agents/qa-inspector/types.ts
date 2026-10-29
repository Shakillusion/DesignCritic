/** Objective, programmatic QA results for a rendered design document. */
export interface QaIssue {
  check: "text-overflow" | "out-of-bounds" | "clipping" | "contrast" | "low-resolution" | "missing-asset" | "safe-margin" | "font-fallback" | "dimensions" | "brand-color" | "brand-font" | "overlap";
  severity: "error" | "warning" | "info";
  layerId: string | null;
  message: string;
  /** Measured values that back the message, so it is verifiable. */
  measured?: Record<string, number | string>;
}

export interface QaReport {
  passed: boolean;
  checkedAt: string;
  artboard: { width: number; height: number };
  issues: QaIssue[];
  checksRun: string[];
}
