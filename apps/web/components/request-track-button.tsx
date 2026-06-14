"use client";

import { Check, LoaderCircle, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestTrackingAction, type RequestTrackingActionResult } from "../app/actions";
import type { SearchActionState } from "@media-track/workflow";
import { RequestedBadge } from "./request-state";

/**
 * Acquire control for a movie candidate. Three visual states, kept consistent
 * with SeasonRequestMenu / RequestSeriesButton:
 *  - requestable → a green "获取" pill;
 *  - in progress (just requested, or an active workflow) → a spinning "已请求"
 *    badge (a spinner, not a checkmark — it is NOT done yet);
 *  - settled (already acquired / still tracked) → a "已获取" / "已追踪" badge.
 */
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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RequestTrackingActionResult | null>(null);

  // Once the SERVER reports the run finished (already_tracked), the optimistic
  // "已请求" from the click must release — otherwise the AcquiringPoller refreshes
  // actionState but the button stays stuck on "已请求" until a manual reload.
  // NOTE: only already_tracked counts as done — active_workflow also sets
  // `disabled`, so we must NOT treat disabled as settled or an in-flight run
  // would wrongly show the green "done" badge.
  const inProgress =
    actionState !== "already_tracked" &&
    (result?.status === "requested" ||
      result?.status === "active_workflow" ||
      actionState === "active_workflow");
  const settled =
    !inProgress &&
    (disabled || actionState === "already_tracked" || result?.status === "already_tracked");

  if (inProgress) {
    return <RequestedBadge title={result?.message} />;
  }

  if (settled) {
    return (
      <span className="hub-badge tone-green">
        <Check size={12} aria-hidden />
        {label}
      </span>
    );
  }

  return (
    <div className="request-track">
      <button
        className="primary-button"
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            setResult(
              await requestTrackingAction({
                ...(candidateId ? { candidateId } : {}),
                currentState: actionState,
              }),
            );
            // Re-fetch so the now-queued run mounts the AcquiringPoller, which
            // then flips this card to 已获取 when the run finishes.
            router.refresh();
          });
        }}
      >
        {isPending ? (
          <LoaderCircle size={16} className="spin" aria-hidden />
        ) : (
          <Plus size={16} aria-hidden />
        )}
        {isPending ? "请求中" : label}
      </button>
      {/* A non-queued result (e.g. unsupported / failed) fell through to the
          requestable button — surface its reason instead of swallowing it. */}
      {result ? <p className="request-result">{result.message}</p> : null}
    </div>
  );
}
