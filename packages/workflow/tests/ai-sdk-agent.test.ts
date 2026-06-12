import { describe, expect, it } from "vitest";
import {
  VercelAiAgentNodes,
  type ResourceCandidate,
} from "../src/index.js";

describe("VercelAiAgentNodes", () => {
  it("turns structured keyword output into keyword agent results", async () => {
    const agent = new VercelAiAgentNodes({
      generateStructuredOutput: async (request) => {
        expect(request.schemaName).toBe("keyword_generation");
        expect(request.prompt).toContain("Show");
        return {
          keywords: ["Show 4K", "Show S01"],
          reason: "Use title plus quality and season hints.",
        };
      },
    });

    await expect(
      agent.generateKeywords({
        title: "Show",
        aliases: ["The Show"],
        missingEpisodes: ["S01E01"],
        previousErrors: [],
      }),
    ).resolves.toEqual({
      keywords: ["Show 4K", "Show S01"],
      reason: "Use title plus quality and season hints.",
    });
  });

  it("turns structured episode coverage output into an agent decision", async () => {
    const candidates: ResourceCandidate[] = [
      {
        id: "snapshot_1_candidate_1",
        snapshotId: "snapshot_1",
        index: 0,
        title: "Show S01E01 4K",
        type: "115",
        source: "fake",
        episodeHints: ["S01E01"],
        qualityHints: ["4K"],
        providerPayload: {},
      },
      {
        id: "snapshot_1_candidate_2",
        snapshotId: "snapshot_1",
        index: 1,
        title: "Unrelated",
        type: "115",
        source: "fake",
        episodeHints: [],
        qualityHints: [],
        providerPayload: {},
      },
    ];
    const agent = new VercelAiAgentNodes({
      generateStructuredOutput: async (request) => {
        expect(request.schemaName).toBe("episode_coverage");
        expect(request.prompt).toContain("snapshot_1_candidate_1");
        return {
          selectedCandidateIds: ["snapshot_1_candidate_1"],
          episodeMapping: {
            snapshot_1_candidate_1: ["S01E01"],
          },
          providerAheadEpisodeMapping: {},
          rejectedCandidateIds: ["snapshot_1_candidate_2"],
          confidence: "high",
          reason: "The first candidate covers the missing episode.",
        };
      },
    });

    await expect(
      agent.selectEpisodeCoverage({
        snapshotId: "snapshot_1",
        candidates,
        missingEpisodes: ["S01E01"],
        latestAiredEpisode: 1,
      }),
    ).resolves.toEqual({
      node: "vercel_ai_episode_coverage",
      snapshotId: "snapshot_1",
      selectedCandidateIds: ["snapshot_1_candidate_1"],
      episodeMapping: {
        snapshot_1_candidate_1: ["S01E01"],
      },
      providerAheadEpisodeMapping: {},
      rejectedCandidateIds: ["snapshot_1_candidate_2"],
      confidence: "high",
      reason: "The first candidate covers the missing episode.",
    });
  });

  it("turns structured candidate match output into a target-resource judgment", async () => {
    const candidates: ResourceCandidate[] = [
      {
        id: "snapshot_1_candidate_1",
        snapshotId: "snapshot_1",
        index: 0,
        title: "Different Show S01E01 4K",
        type: "115",
        source: "fake",
        episodeHints: ["S01E01"],
        qualityHints: ["4K"],
        providerPayload: {},
      },
      {
        id: "snapshot_1_candidate_2",
        snapshotId: "snapshot_1",
        index: 1,
        title: "Show S01E01 4K",
        type: "115",
        source: "fake",
        episodeHints: ["S01E01"],
        qualityHints: ["4K"],
        providerPayload: {},
      },
    ];
    const agent = new VercelAiAgentNodes({
      generateStructuredOutput: async (request) => {
        expect(request.schemaName).toBe("candidate_match");
        expect(request.prompt).toContain("Different Show");
        return {
          matchedCandidateIds: ["snapshot_1_candidate_2"],
          rejectedCandidateIds: ["snapshot_1_candidate_1"],
          uncertainCandidateIds: [],
          confidence: "high",
          reason: "The second candidate is the target title.",
        };
      },
    });

    await expect(
      agent.matchCandidates({
        snapshotId: "snapshot_1",
        title: "Show",
        aliases: ["The Show"],
        candidates,
      }),
    ).resolves.toEqual({
      node: "vercel_ai_candidate_match",
      snapshotId: "snapshot_1",
      matchedCandidateIds: ["snapshot_1_candidate_2"],
      rejectedCandidateIds: ["snapshot_1_candidate_1"],
      uncertainCandidateIds: [],
      confidence: "high",
      reason: "The second candidate is the target title.",
    });
  });

  it("turns structured package recognition output into a bounded file mapping decision", async () => {
    const agent = new VercelAiAgentNodes({
      generateStructuredOutput: async (request) => {
        expect(request.schemaName).toBe("package_recognition");
        expect(request.prompt).toContain("provider_1");
        return {
          fileMappings: [
            {
              providerFileId: "provider_1",
              seasonNumber: 1,
              episodeNumber: 1,
              confidence: "medium",
              reason: "The parent package and filename indicate the first episode.",
            },
          ],
          rejectedProviderFileIds: [],
          confidence: "medium",
          reason: "One ambiguous package file was mapped.",
        };
      },
    });

    await expect(
      agent.recognizePackage({
        title: "Show",
        year: 2024,
        files: [
          {
            path: "Show Pack/Disc A/Episode 01.mkv",
            providerFileId: "provider_1",
            sizeBytes: 100,
          },
        ],
        parserEvidence: [
          {
            path: "Show Pack/Disc A/Episode 01.mkv",
            providerFileId: "provider_1",
            parsedSeasonNumber: null,
            parsedEpisodeNumber: 1,
            confidence: "medium",
            evidence: ["filename_episode"],
          },
        ],
      }),
    ).resolves.toEqual({
      node: "vercel_ai_package_recognition",
      fileMappings: [
        {
          providerFileId: "provider_1",
          seasonNumber: 1,
          episodeNumber: 1,
          confidence: "medium",
          reason: "The parent package and filename indicate the first episode.",
        },
      ],
      rejectedProviderFileIds: [],
      confidence: "medium",
      reason: "One ambiguous package file was mapped.",
    });
  });
});
