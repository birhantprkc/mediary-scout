import {
  createEpisodeStates,
  reconcileVerifiedFiles,
  type AgentDecision,
  type AuditEvent,
  type CandidateMatchDecision,
  type EpisodeState,
  type MediaTitle,
  type NotificationEvent,
  type ResourceCandidate,
  type ResourceSnapshot,
  type TrackedSeason,
  type TransferAttempt,
  type WorkflowStatus,
} from "./domain.js";
import type { AgentNodes, ResourceProvider, StorageExecutor } from "./ports.js";

const TYPE2_WORKFLOW_RUN_ID = "run_type2";
const TYPE3_WORKFLOW_RUN_ID = "run_type3";
const FIXED_CREATED_AT = "2026-01-01T00:00:00.000Z";

export interface WorkflowResult {
  status: WorkflowStatus;
  episodes: EpisodeState[];
  obtainedEpisodes: string[];
  providerAheadEpisodes: string[];
  resourceSnapshots: ResourceSnapshot[];
  transferAttempts: TransferAttempt[];
  decisions: AgentDecision[];
  notification: NotificationEvent;
  notifications: NotificationEvent[];
  auditEvents: AuditEvent[];
}

export async function runType2Initialization(input: {
  title: MediaTitle;
  season: TrackedSeason;
  keyword: string;
  resourceProvider: ResourceProvider;
  storage: StorageExecutor;
  agents: AgentNodes;
  workflowRunId?: string;
}): Promise<WorkflowResult> {
  const workflowRunId = input.workflowRunId ?? TYPE2_WORKFLOW_RUN_ID;
  const episodes = createEpisodeStates({
    trackedSeasonId: input.season.id,
    seasonNumber: input.season.seasonNumber,
    totalEpisodes: input.season.totalEpisodes,
    latestAiredEpisode: input.season.latestAiredEpisode,
  });
  const missingEpisodes = episodes
    .filter((episode) => episode.airStatus === "aired" && !episode.obtained)
    .map((episode) => episode.episodeCode);

  const auditEvents: AuditEvent[] = [];
  const snapshot = await searchResourceSnapshot({
    title: input.title,
    keyword: input.keyword,
    missingEpisodes,
    resourceProvider: input.resourceProvider,
    agents: input.agents,
    auditEvents,
  });
  const matchedCandidates = await matchSnapshotCandidates({
    title: input.title,
    snapshot,
    agents: input.agents,
    auditEvents,
  });

  const decision = await input.agents.selectEpisodeCoverage({
    snapshotId: snapshot.id,
    candidates: matchedCandidates,
    missingEpisodes,
    latestAiredEpisode: input.season.latestAiredEpisode,
  });
  assertDecisionUsesSnapshot(decision, matchedCandidates, snapshot.id);
  const transferAttempts: TransferAttempt[] = [];
  for (const candidateId of decision.selectedCandidateIds) {
    const candidate = requireCandidate(snapshot.candidates, candidateId);
    transferAttempts.push(
      await input.storage.transfer({
        workflowRunId,
        directoryId: input.season.storageDirectoryId,
        candidate,
      }),
    );
  }

  await input.storage.flattenDirectory(input.season.storageDirectoryId);
  const verifiedFiles = await input.storage.listVideoFiles(input.season.storageDirectoryId);
  const reconciledEpisodes = reconcileVerifiedFiles({
    season: input.season,
    episodes,
    files: verifiedFiles,
  });
  const obtainedEpisodes = reconciledEpisodes
    .filter((episode) => episode.obtained)
    .map((episode) => episode.episodeCode);
  const providerAheadEpisodes = collectProviderAheadEpisodes(reconciledEpisodes);
  const notification: NotificationEvent = {
    id: `notification_${workflowRunId}`,
    workflowRunId,
    kind: "tracking_initialized",
    title: `${input.title.title} tracking initialized`,
    body: `${obtainedEpisodes.length} episodes obtained`,
    createdAt: FIXED_CREATED_AT,
  };

  return {
    status: "succeeded",
    episodes: reconciledEpisodes,
    obtainedEpisodes,
    providerAheadEpisodes,
    resourceSnapshots: [snapshot],
    transferAttempts,
    decisions: [decision],
    notification,
    notifications: [notification],
    auditEvents,
  };
}

export async function runType3Monitoring(input: {
  title: MediaTitle;
  season: TrackedSeason;
  episodes: EpisodeState[];
  keyword: string;
  resourceProvider: ResourceProvider;
  storage: StorageExecutor;
  agents: AgentNodes;
  workflowRunId?: string;
}): Promise<WorkflowResult> {
  const workflowRunId = input.workflowRunId ?? TYPE3_WORKFLOW_RUN_ID;
  const auditEvents: AuditEvent[] = [];
  const currentFiles = await input.storage.listVideoFiles(input.season.storageDirectoryId);
  let episodes = reconcileVerifiedFiles({
    season: input.season,
    episodes: input.episodes.map((episode) => {
      const matchingFiles = currentFiles.filter((file) => file.episodeCode === episode.episodeCode);
      return {
        ...episode,
        obtained: matchingFiles.length > 0,
        verifiedFileIds: matchingFiles.map((file) => file.id),
      };
    }),
    files: currentFiles,
  });
  const actionableMissing = episodes
    .filter((episode) => episode.airStatus === "aired" && !episode.obtained)
    .map((episode) => episode.episodeCode);

  if (actionableMissing.length === 0) {
    const notification: NotificationEvent = {
      id: `notification_${workflowRunId}_noop`,
      workflowRunId,
      kind: "already_current",
      title: `${input.title.title} already current`,
      body: "0 episodes restored",
      createdAt: FIXED_CREATED_AT,
    };
    return {
      status: "succeeded",
      episodes,
      obtainedEpisodes: episodes.filter((episode) => episode.obtained).map((episode) => episode.episodeCode),
      providerAheadEpisodes: collectProviderAheadEpisodes(episodes),
      resourceSnapshots: [],
      transferAttempts: [],
      decisions: [],
      notification,
      notifications: [notification],
      auditEvents,
    };
  }

  const snapshot = await searchResourceSnapshot({
    title: input.title,
    keyword: input.keyword,
    missingEpisodes: actionableMissing,
    resourceProvider: input.resourceProvider,
    agents: input.agents,
    auditEvents,
  });
  const matchedCandidates = await matchSnapshotCandidates({
    title: input.title,
    snapshot,
    agents: input.agents,
    auditEvents,
  });

  const decision = await input.agents.selectEpisodeCoverage({
    snapshotId: snapshot.id,
    candidates: matchedCandidates,
    missingEpisodes: actionableMissing,
    latestAiredEpisode: input.season.latestAiredEpisode,
  });
  assertDecisionUsesSnapshot(decision, matchedCandidates, snapshot.id);

  const transferAttempts: TransferAttempt[] = [];
  const restored = new Set<string>();

  for (const candidateId of decision.selectedCandidateIds) {
    const candidate = requireCandidate(snapshot.candidates, candidateId);
    transferAttempts.push(
      await input.storage.transfer({
        workflowRunId,
        directoryId: input.season.storageDirectoryId,
        candidate,
      }),
    );
    addRestoredEpisodes(
      restored,
      actionableMissing,
      await input.storage.listVideoFiles(input.season.storageDirectoryId),
    );
  }

  await input.storage.flattenDirectory(input.season.storageDirectoryId);
  const finalFiles = await input.storage.listVideoFiles(input.season.storageDirectoryId);
  episodes = reconcileVerifiedFiles({
    season: input.season,
    episodes,
    files: finalFiles,
  });
  const obtainedEpisodes = episodes.filter((episode) => episode.obtained).map((episode) => episode.episodeCode);
  const providerAheadEpisodes = collectProviderAheadEpisodes(episodes);
  const notification: NotificationEvent = {
    id: `notification_${workflowRunId}`,
    workflowRunId,
    kind: "episodes_restored",
    title: `${input.title.title} episodes restored`,
    body: `${restored.size} episodes restored`,
    createdAt: FIXED_CREATED_AT,
  };

  return {
    status: "succeeded",
    episodes,
    obtainedEpisodes,
    providerAheadEpisodes,
    resourceSnapshots: [snapshot],
    transferAttempts,
    decisions: [decision],
    notification,
    notifications: [notification],
    auditEvents,
  };
}

function addRestoredEpisodes(restored: Set<string>, missingEpisodes: string[], files: { episodeCode: string }[]): void {
  for (const file of files) {
    if (missingEpisodes.includes(file.episodeCode)) {
      restored.add(file.episodeCode);
    }
  }
}

async function searchResourceSnapshot(input: {
  title: MediaTitle;
  keyword: string;
  missingEpisodes: string[];
  resourceProvider: ResourceProvider;
  agents: AgentNodes;
  auditEvents: AuditEvent[];
}): Promise<ResourceSnapshot> {
  const keywordPlan = await input.agents.generateKeywords({
    title: input.title.title,
    aliases: input.title.aliases,
    missingEpisodes: input.missingEpisodes,
    previousErrors: [],
  });
  input.auditEvents.push({
    type: "keyword_plan_created",
    message: "Created agent keyword plan",
    data: {
      keywords: keywordPlan.keywords,
      reason: keywordPlan.reason,
    },
  });

  let lastEmptySnapshot: ResourceSnapshot | null = null;
  let lastError: unknown = null;
  for (const keyword of uniqueKeywords([input.keyword, ...keywordPlan.keywords])) {
    try {
      const snapshot = await input.resourceProvider.search({ keyword });
      input.auditEvents.push({
        type: "resource_snapshot_created",
        message: `Created resource snapshot ${snapshot.id}`,
        data: {
          snapshotId: snapshot.id,
          keyword: snapshot.keyword,
          candidateCount: snapshot.candidates.length,
        },
      });
      if (snapshot.candidates.length > 0) {
        return snapshot;
      }
      lastEmptySnapshot = snapshot;
      input.auditEvents.push({
        type: "keyword_search_empty",
        message: `Search keyword returned no candidates: ${keyword}`,
        data: { keyword },
      });
    } catch (error) {
      lastError = error;
      input.auditEvents.push({
        type: "keyword_search_failed",
        message: `Search keyword failed: ${keyword}`,
        data: {
          keyword,
          error: errorMessage(error),
        },
      });
    }
  }

  if (lastError !== null) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`Resource search failed before a usable resource snapshot could be created: ${String(lastError)}`);
  }

  if (lastEmptySnapshot !== null) {
    return lastEmptySnapshot;
  }

  throw new Error("Resource search failed before a resource snapshot could be created");
}

async function matchSnapshotCandidates(input: {
  title: MediaTitle;
  snapshot: ResourceSnapshot;
  agents: AgentNodes;
  auditEvents: AuditEvent[];
}): Promise<ResourceCandidate[]> {
  const decision = await input.agents.matchCandidates({
    snapshotId: input.snapshot.id,
    title: input.title.title,
    aliases: input.title.aliases,
    candidates: input.snapshot.candidates,
  });
  assertCandidateMatchUsesSnapshot(decision, input.snapshot.candidates, input.snapshot.id);
  input.auditEvents.push({
    type: "candidate_match_decision_created",
    message: `Created candidate match decision ${decision.node}`,
    data: {
      snapshotId: decision.snapshotId,
      matchedCandidateIds: decision.matchedCandidateIds,
      rejectedCandidateIds: decision.rejectedCandidateIds,
      uncertainCandidateIds: decision.uncertainCandidateIds,
      confidence: decision.confidence,
      reason: decision.reason,
    },
  });

  const matchedIds = new Set(decision.matchedCandidateIds);
  return input.snapshot.candidates.filter((candidate) => matchedIds.has(candidate.id));
}

function collectProviderAheadEpisodes(episodes: EpisodeState[]): string[] {
  return episodes
    .filter((episode) => episode.obtained && episode.metadataStatus === "provider_ahead")
    .map((episode) => episode.episodeCode);
}

function requireCandidate(candidates: ResourceCandidate[], candidateId: string): ResourceCandidate {
  const candidate = candidates.find((item) => item.id === candidateId);
  if (!candidate) {
    throw new Error(`Candidate ${candidateId} was not found in the current resource snapshot`);
  }
  return candidate;
}

function assertDecisionUsesSnapshot(
  decision: AgentDecision,
  candidates: { id: string; snapshotId: string }[],
  snapshotId: string,
): void {
  if (decision.snapshotId !== snapshotId) {
    throw new Error("Agent decision referenced a different resource snapshot");
  }

  const candidatesFromOtherSnapshots = candidates.filter((candidate) => candidate.snapshotId !== snapshotId);
  if (candidatesFromOtherSnapshots.length > 0) {
    throw new Error("Resource snapshot contained candidates from another snapshot");
  }

  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const decisionCandidateIds = [
    ...decision.selectedCandidateIds,
    ...decision.rejectedCandidateIds,
    ...Object.keys(decision.episodeMapping),
    ...Object.keys(decision.providerAheadEpisodeMapping),
  ];
  const unknownCandidateIds = decisionCandidateIds.filter((candidateId) => !candidateIds.has(candidateId));
  if (unknownCandidateIds.length > 0) {
    throw new Error(`Agent decision referenced candidates outside the current resource snapshot: ${unknownCandidateIds.join(", ")}`);
  }
}

function assertCandidateMatchUsesSnapshot(
  decision: CandidateMatchDecision,
  candidates: { id: string; snapshotId: string }[],
  snapshotId: string,
): void {
  if (decision.snapshotId !== snapshotId) {
    throw new Error("Candidate match decision referenced a different resource snapshot");
  }

  const candidatesFromOtherSnapshots = candidates.filter((candidate) => candidate.snapshotId !== snapshotId);
  if (candidatesFromOtherSnapshots.length > 0) {
    throw new Error("Resource snapshot contained candidates from another snapshot");
  }

  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const decisionCandidateIds = [
    ...decision.matchedCandidateIds,
    ...decision.rejectedCandidateIds,
    ...decision.uncertainCandidateIds,
  ];
  const unknownCandidateIds = decisionCandidateIds.filter((candidateId) => !candidateIds.has(candidateId));
  if (unknownCandidateIds.length > 0) {
    throw new Error(
      `Candidate match decision referenced candidates outside the current resource snapshot: ${unknownCandidateIds.join(", ")}`,
    );
  }

  const bucketsByCandidateId = new Map<string, string[]>();
  for (const [bucket, ids] of [
    ["matched", decision.matchedCandidateIds],
    ["rejected", decision.rejectedCandidateIds],
    ["uncertain", decision.uncertainCandidateIds],
  ] as const) {
    for (const id of ids) {
      bucketsByCandidateId.set(id, [...(bucketsByCandidateId.get(id) ?? []), bucket]);
    }
  }
  const duplicatedCandidates = Array.from(bucketsByCandidateId.entries())
    .filter(([, buckets]) => buckets.length > 1)
    .map(([candidateId]) => candidateId);
  if (duplicatedCandidates.length > 0) {
    throw new Error(`Candidate match decision put candidates in multiple buckets: ${duplicatedCandidates.join(", ")}`);
  }
}

function uniqueKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
