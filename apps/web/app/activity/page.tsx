import { Suspense } from "react";
import { connection } from "next/server";
import { AppSidebar } from "../../components/app-sidebar";
import { ActivityFeed } from "../../components/activity-feed";
import { getActivityView } from "../../lib/activity-view";
import { ensureDemoSeeded, getWorkflowRepository } from "../../lib/workflow-runtime";

export default function ActivityPage() {
  return (
    <div className="app-shell">
      <AppSidebar active="activity" />
      <main className="main product-main">
        <div className="section-heading library-heading">
          <div>
            <h1>活动</h1>
            <p>点了获取之后，资源在这里逐个被处理 —— 看得见 agent 正在干什么</p>
          </div>
        </div>
        <Suspense fallback={<ActivitySkeleton />}>
          <ActivityInner />
        </Suspense>
      </main>
    </div>
  );
}

async function ActivityInner() {
  await connection();
  const repository = getWorkflowRepository();
  await ensureDemoSeeded(repository);
  // since = now: 已完成 is session-scoped, so the first render shows none — only
  // tasks that finish WHILE this page is open accumulate (history lives in 通知).
  const since = new Date().toISOString();
  const initialView = await getActivityView({ repository, since });
  return <ActivityFeed initialView={initialView} initialSince={since} />;
}

function ActivitySkeleton() {
  return (
    <div className="activity">
      <div className="skeleton-card" style={{ height: 96 }} />
      <div className="skeleton-card" style={{ height: 64 }} />
    </div>
  );
}
