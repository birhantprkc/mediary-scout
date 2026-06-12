import type { WorkflowStatus } from "./domain.js";
import type { AgentNodes, ResourceProvider, StorageExecutor } from "./ports.js";
import type { PersistedWorkflowRunSnapshot, WorkflowRepository } from "./repository.js";
import { runType2InitializationAndPersist } from "./runner.js";

export type QueuedType2WorkerResult =
  | {
      status: "idle";
    }
  | {
    status: "ran";
    workflowRunId: string;
    workflowStatus: WorkflowStatus;
  }
  | {
      status: "failed";
      workflowRunId: string;
      errorMessage: string;
    };

export async function runQueuedType2Workflow(input: {
  repository: WorkflowRepository;
  resourceProvider: ResourceProvider;
  storage: StorageExecutor;
  agents: AgentNodes;
  now?: () => string;
}): Promise<QueuedType2WorkerResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const claimed = await input.repository.claimNextQueuedWorkflowRun({
    kind: "type2_init",
    now: now(),
  });
  if (!claimed) {
    return { status: "idle" };
  }

  const keyword = keywordFromQueuedRun(claimed);
  try {
    const result = await runType2InitializationAndPersist({
      title: claimed.title,
      season: claimed.season,
      keyword,
      resourceProvider: input.resourceProvider,
      storage: input.storage,
      agents: input.agents,
      repository: input.repository,
      workflowRun: {
        id: claimed.workflowRun.id,
        startedAt: claimed.workflowRun.startedAt,
        finishedAt: now(),
      },
    });

    return {
      status: "ran",
      workflowRunId: claimed.workflowRun.id,
      workflowStatus: result.status,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Workflow failed";
    await input.repository.saveWorkflowRunSnapshot({
      title: claimed.title,
      season: claimed.season,
      workflowRun: {
        ...claimed.workflowRun,
        status: "failed",
        finishedAt: now(),
        auditEvents: [
          ...claimed.workflowRun.auditEvents,
          {
            type: "workflow_failed",
            message: errorMessage,
          },
        ],
      },
      episodes: [],
      resourceSnapshots: [],
      decisions: [],
      transferAttempts: [],
      notifications: [],
    });

    return {
      status: "failed",
      workflowRunId: claimed.workflowRun.id,
      errorMessage,
    };
  }
}

function keywordFromQueuedRun(snapshot: PersistedWorkflowRunSnapshot): string {
  const queuedEvent = snapshot.workflowRun.auditEvents.find(
    (event) => event.type === "tracking_request_queued" && typeof event.data?.["keyword"] === "string",
  );
  if (typeof queuedEvent?.data?.["keyword"] === "string") {
    return queuedEvent.data["keyword"];
  }
  return `${snapshot.title.title} ${snapshot.season.qualityPreference}`.trim();
}
