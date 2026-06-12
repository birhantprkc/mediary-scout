import { describe, expect, it } from "vitest";
import {
  FakeAgentNodes,
  FakeResourceProvider,
  FakeStorageExecutor,
  runType2Initialization,
  type MediaTitle,
  type ResourceCandidate,
  type StorageExecutor,
  type TrackedSeason,
  type TransferAttempt,
} from "../src/index.js";

describe("runType2Initialization", () => {
  it("initializes tracking and marks only verified current episodes obtained", async () => {
    const title: MediaTitle = {
      id: "title_qiaochu",
      tmdbId: 289271,
      type: "tv",
      title: "翘楚",
      originalTitle: "翘楚",
      year: 2026,
      aliases: ["Ashes to Crown"],
    };
    const season: TrackedSeason = {
      id: "season_qiaochu_1",
      mediaTitleId: title.id,
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "dir_qiaochu_s1",
      totalEpisodes: 24,
      latestAiredEpisode: 14,
      latestAiredSource: "metadata",
    };

    const resourceProvider = new FakeResourceProvider({
      keywordResults: {
        "翘楚 4K": Array.from({ length: 14 }, (_, index) => ({
          title: `翘楚 S01E${String(index + 1).padStart(2, "0")} 4K`,
          episodeHints: [`S01E${String(index + 1).padStart(2, "0")}`],
          qualityHints: ["4K"],
        })),
      },
    });
    const storage = new FakeStorageExecutor({
      directories: { dir_qiaochu_s1: [] },
      transferOutcomes: Object.fromEntries(
        Array.from({ length: 14 }, (_, index) => {
          const episode = `S01E${String(index + 1).padStart(2, "0")}`;
          const candidateId = `snapshot_1_candidate_${index + 1}`;
          return [
            candidateId,
            {
              status: "succeeded",
              providerMessage: "",
              files: [
                {
                  id: `file_${episode}`,
                  storageDirectoryId: "dir_qiaochu_s1",
                  name: `翘楚.${episode}.mkv`,
                  sizeBytes: 1_000_000_000,
                  episodeCode: episode,
                  providerFileId: `provider_${episode}`,
                },
              ],
            },
          ];
        }),
      ),
    });

    const result = await runType2Initialization({
      title,
      season,
      keyword: "翘楚 4K",
      resourceProvider,
      storage,
      agents: new FakeAgentNodes(),
    });

    expect(result.status).toBe("succeeded");
    expect(result.obtainedEpisodes).toEqual(
      Array.from({ length: 14 }, (_, index) => `S01E${String(index + 1).padStart(2, "0")}`),
    );
    expect(result.episodes.filter((episode) => episode.obtained)).toHaveLength(14);
    expect(result.episodes.find((episode) => episode.episodeCode === "S01E15")).toMatchObject({
      obtained: false,
      airStatus: "unaired",
    });
    expect(result.notification.body).toContain("14 episodes obtained");
    expect(result.notifications).toEqual([result.notification]);
  });

  it("records provider-ahead episodes during initialization when selected resources materialize them", async () => {
    const title: MediaTitle = {
      id: "title_qiaochu",
      tmdbId: 289271,
      type: "tv",
      title: "翘楚",
      originalTitle: "翘楚",
      year: 2026,
      aliases: ["Ashes to Crown"],
    };
    const season: TrackedSeason = {
      id: "season_qiaochu_1",
      mediaTitleId: title.id,
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "dir_qiaochu_s1",
      totalEpisodes: 24,
      latestAiredEpisode: 14,
      latestAiredSource: "metadata",
    };
    const resourceProvider = new FakeResourceProvider({
      keywordResults: {
        "翘楚 4K": [
          {
            title: "翘楚 S01E14-S01E15 4K",
            episodeHints: ["S01E14", "S01E15"],
            qualityHints: ["4K"],
          },
        ],
      },
    });
    const storage = new FakeStorageExecutor({
      directories: { dir_qiaochu_s1: [] },
      transferOutcomes: {
        snapshot_1_candidate_1: {
          status: "succeeded",
          providerMessage: "",
          files: [
            {
              id: "file_S01E14",
              storageDirectoryId: "dir_qiaochu_s1",
              name: "翘楚.S01E14.mkv",
              sizeBytes: 1_000_000_000,
              episodeCode: "S01E14",
              providerFileId: "provider_S01E14",
            },
            {
              id: "file_S01E15",
              storageDirectoryId: "dir_qiaochu_s1",
              name: "翘楚.S01E15.mkv",
              sizeBytes: 1_000_000_000,
              episodeCode: "S01E15",
              providerFileId: "provider_S01E15",
            },
          ],
        },
      },
    });

    const result = await runType2Initialization({
      title,
      season,
      keyword: "翘楚 4K",
      resourceProvider,
      storage,
      agents: new FakeAgentNodes(),
    });

    expect(result.obtainedEpisodes).toEqual(["S01E14", "S01E15"]);
    expect(result.providerAheadEpisodes).toEqual(["S01E15"]);
    expect(result.episodes.find((episode) => episode.episodeCode === "S01E15")).toMatchObject({
      airStatus: "unaired",
      obtained: true,
      metadataStatus: "provider_ahead",
      verifiedFileIds: ["file_S01E15"],
    });
  });

  it("uses the keyword agent to recover from an empty or failed initial search keyword", async () => {
    const title: MediaTitle = {
      id: "title_show",
      tmdbId: 1,
      type: "tv",
      title: "Show",
      originalTitle: "Show",
      year: 2026,
      aliases: ["The Show"],
    };
    const season: TrackedSeason = {
      id: "season_show_1",
      mediaTitleId: title.id,
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "dir_show_s1",
      totalEpisodes: 1,
      latestAiredEpisode: 1,
      latestAiredSource: "metadata",
    };
    const resourceProvider = new FakeResourceProvider({
      keywordErrors: {
        "Show 4K": "PanSou rejected the initial keyword",
      },
      keywordResults: {
        "The Show S01": [
          {
            title: "The Show S01E01 4K",
            episodeHints: ["S01E01"],
            qualityHints: ["4K"],
          },
        ],
      },
    });

    const result = await runType2Initialization({
      title,
      season,
      keyword: "Show 4K",
      resourceProvider,
      storage: new FakeStorageExecutor({ directories: { dir_show_s1: [] } }),
      agents: new KeywordRecoveringAgentNodes(),
    });

    expect(result.resourceSnapshots[0]?.keyword).toBe("The Show S01");
    expect(result.auditEvents.map((event) => event.type)).toContain("keyword_search_failed");
  });

  it("filters resource candidates through the candidate-match agent before episode coverage selection", async () => {
    const title: MediaTitle = {
      id: "title_show",
      tmdbId: 1,
      type: "tv",
      title: "Show",
      originalTitle: "Show",
      year: 2026,
      aliases: ["The Show"],
    };
    const season: TrackedSeason = {
      id: "season_show_1",
      mediaTitleId: title.id,
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "dir_show_s1",
      totalEpisodes: 1,
      latestAiredEpisode: 1,
      latestAiredSource: "metadata",
    };
    const storage = new RecordingCandidateStorage();

    await runType2Initialization({
      title,
      season,
      keyword: "Show 4K",
      resourceProvider: new FakeResourceProvider({
        keywordResults: {
          "Show 4K": [
            {
              title: "Different Show S01E01 4K",
              episodeHints: ["S01E01"],
              qualityHints: ["4K"],
            },
            {
              title: "Show S01E01 4K",
              episodeHints: ["S01E01"],
              qualityHints: ["4K"],
            },
          ],
        },
      }),
      storage,
      agents: new CandidateMatchFilteringAgentNodes(),
      workflowRunId: "run_candidate_match",
    });

    expect(storage.transfers.map((transfer) => transfer.candidate.id)).toEqual(["snapshot_1_candidate_2"]);
  });

  it("passes the selected resource candidate payload to storage transfer", async () => {
    const title: MediaTitle = {
      id: "title_show",
      tmdbId: 1,
      type: "tv",
      title: "Show",
      originalTitle: "Show",
      year: 2026,
      aliases: [],
    };
    const season: TrackedSeason = {
      id: "season_show_1",
      mediaTitleId: title.id,
      seasonNumber: 1,
      status: "active",
      qualityPreference: "4K",
      storageDirectoryId: "dir_show_s1",
      totalEpisodes: 1,
      latestAiredEpisode: 1,
      latestAiredSource: "metadata",
    };
    const storage = new RecordingCandidateStorage();

    await runType2Initialization({
      title,
      season,
      keyword: "Show 4K",
      resourceProvider: new FakeResourceProvider({
        keywordResults: {
          "Show 4K": [
            {
              title: "Show S01E01 4K",
              episodeHints: ["S01E01"],
              qualityHints: ["4K"],
              providerPayload: {
                url: "https://115.com/s/abc123?password=pw",
                rawType: "115",
                password: "pw",
              },
            },
          ],
        },
      }),
      storage,
      agents: new FakeAgentNodes(),
      workflowRunId: "run_candidate_payload",
    });

    expect(storage.transfers[0]?.candidate).toMatchObject({
      id: "snapshot_1_candidate_1",
      providerPayload: {
        url: "https://115.com/s/abc123?password=pw",
        rawType: "115",
        password: "pw",
      },
    });
  });
});

class RecordingCandidateStorage implements StorageExecutor {
  readonly transfers: Array<{
    workflowRunId: string;
    directoryId: string;
    candidate: ResourceCandidate;
  }> = [];

  async createDirectory(): Promise<string> {
    return "dir_created";
  }

  async listVideoFiles() {
    return [];
  }

  async transfer(input: {
    workflowRunId: string;
    directoryId: string;
    candidate: ResourceCandidate;
  }): Promise<TransferAttempt> {
    this.transfers.push(input);
    return {
      id: "transfer_1",
      workflowRunId: input.workflowRunId,
      candidateId: input.candidate.id,
      status: "succeeded",
      providerMessage: "",
      materializedFileIds: [],
    };
  }

  async flattenDirectory(): Promise<{ moved: string[]; removed: string[] }> {
    return { moved: [], removed: [] };
  }

  async deleteFiles(): Promise<{ deleted: string[] }> {
    return { deleted: [] };
  }
}

class KeywordRecoveringAgentNodes extends FakeAgentNodes {
  async generateKeywords() {
    return {
      keywords: ["The Show S01"],
      reason: "Use the alias and season when the initial keyword fails.",
    };
  }
}

class CandidateMatchFilteringAgentNodes extends FakeAgentNodes {
  async matchCandidates(input: { snapshotId: string; candidates: ResourceCandidate[] }) {
    return {
      node: "test_candidate_match",
      snapshotId: input.snapshotId,
      matchedCandidateIds: input.candidates
        .filter((candidate) => candidate.title === "Show S01E01 4K")
        .map((candidate) => candidate.id),
      rejectedCandidateIds: input.candidates
        .filter((candidate) => candidate.title !== "Show S01E01 4K")
        .map((candidate) => candidate.id),
      uncertainCandidateIds: [],
      confidence: "high" as const,
      reason: "Only the exact target title should reach coverage selection.",
    };
  }
}
