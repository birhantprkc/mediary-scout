export interface WorkflowRuntimeEnv extends Record<string, string | undefined> {
  MEDIA_TRACK_WORKFLOW_ADAPTER?: string;
  MEDIA_TRACK_STORAGE_ADAPTER?: string;
  MEDIA_TRACK_AGENT_ADAPTER?: string;
}

export function assertWorkflowAgentAdapterPolicy(env: WorkflowRuntimeEnv): void {
  const usesLiveProvider = env.MEDIA_TRACK_WORKFLOW_ADAPTER === "pansou";
  const usesLiveStorage = env.MEDIA_TRACK_STORAGE_ADAPTER === "115";
  if (!usesLiveProvider && !usesLiveStorage) {
    return;
  }

  if (env.MEDIA_TRACK_AGENT_ADAPTER === "vercel-ai") {
    return;
  }

  throw new Error(
    "MEDIA_TRACK_AGENT_ADAPTER_REQUIRED_FOR_LIVE_WORKFLOW: set MEDIA_TRACK_AGENT_ADAPTER=vercel-ai when MEDIA_TRACK_WORKFLOW_ADAPTER=pansou or MEDIA_TRACK_STORAGE_ADAPTER=115.",
  );
}
