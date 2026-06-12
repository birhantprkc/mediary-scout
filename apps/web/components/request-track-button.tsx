"use client";

import { Check, LoaderCircle, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { requestTrackingAction, type RequestTrackingActionResult } from "../app/actions";
import type { SearchActionState } from "@media-track/workflow";

export function RequestTrackButton({
  candidateId,
  actionState = "can_request",
  label = "获取",
  disabled = false,
}: {
  candidateId?: string;
  actionState?: SearchActionState;
  label?: string;
  disabled?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RequestTrackingActionResult | null>(null);
  const isLocked =
    disabled ||
    actionState !== "can_request" ||
    result?.status === "requested" ||
    result?.status === "already_tracked" ||
    result?.status === "active_workflow";

  return (
    <div className="request-track">
      <button
        className="primary-button"
        type="button"
        disabled={isPending || isLocked}
        onClick={() => {
          startTransition(async () => {
            setResult(
              await requestTrackingAction({
                ...(candidateId ? { candidateId } : {}),
                currentState: actionState,
              }),
            );
          });
        }}
      >
        {isPending ? (
          <LoaderCircle size={16} className="spin" aria-hidden />
        ) : isLocked ? (
          <Check size={16} aria-hidden />
        ) : (
          <Plus size={16} aria-hidden />
        )}
        {isPending ? "请求中" : label}
      </button>
      {result ? <p className="request-result">{result.message}</p> : null}
    </div>
  );
}
