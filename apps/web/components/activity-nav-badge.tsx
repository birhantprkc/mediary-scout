"use client";

import { useEffect, useState } from "react";

/** Small live count of active (queued + running) acquisitions, shown on the 活动
 *  nav entry. Polls the same endpoint the activity page uses; hidden at zero. */
export function ActivityNavBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/activity?since=${encodeURIComponent(new Date().toISOString())}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { active?: unknown[] };
        if (alive) setCount(Array.isArray(data.active) ? data.active.length : 0);
      } catch {
        // transient — keep the last count
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (count === 0) {
    return null;
  }
  return <span className="nav-badge">{count}</span>;
}
