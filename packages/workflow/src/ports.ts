import type {
  AcquisitionFailureEvidence,
  AcquisitionPlan,
  ResourceCandidate,
  ResourceSnapshot,
  TransferAttempt,
  VerifiedFile,
} from "./domain.js";
import type { AgentNodeTraceEvent } from "./agent-node-runtime.js";
import type {
  PackageRecognitionDecision,
  PackageRecognitionInput,
} from "./package-normalizer.js";

export interface ResourceProvider {
  search(input: { keyword: string }): Promise<ResourceSnapshot>;
}

export interface StorageExecutor {
  createDirectory(input: { name: string; parentId: string }): Promise<string>;
  listVideoFiles(directoryId: string): Promise<VerifiedFile[]>;
  transfer(input: {
    workflowRunId: string;
    directoryId: string;
    candidate: ResourceCandidate;
  }): Promise<TransferAttempt>;
  flattenDirectory(directoryId: string): Promise<{ moved: string[]; removed: string[] }>;
  deleteFiles(input: { directoryId: string; fileIds: string[] }): Promise<{ deleted: string[] }>;
}

export interface AcquisitionPlanningInput {
  title: string;
  aliases: string[];
  seasonNumber: number;
  qualityPreference: string;
  missingEpisodes: string[];
  latestAiredEpisode: number;
  initialKeyword: string;
  failureEvidence: AcquisitionFailureEvidence[];
  searchResources(input: { keyword: string }): Promise<ResourceSnapshot>;
}

export interface AcquisitionPlanningResult {
  plan: AcquisitionPlan;
  snapshots: ResourceSnapshot[];
  trace: AgentNodeTraceEvent[];
}

/**
 * The agent boundary. One node owns the whole acquisition judgment
 * (search strategy, target matching, episode mapping, selection) through
 * read-only tools; one node maps ambiguous package files. Neither can
 * create directories, transfer, delete, or mutate workflow state.
 */
export interface AgentNodes {
  planAcquisition(input: AcquisitionPlanningInput): Promise<AcquisitionPlanningResult>;
  recognizePackage(input: PackageRecognitionInput): Promise<PackageRecognitionDecision>;
}
