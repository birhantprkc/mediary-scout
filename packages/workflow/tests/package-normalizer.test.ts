import { describe, expect, it } from "vitest";
import {
  buildAgentAssistedPackageNormalizationPlan,
  buildPackageNormalizationPlan,
  FakeAgentNodes,
} from "../src/index.js";

describe("buildPackageNormalizationPlan", () => {
  it("plans a complete-series package from nested season folders and SxxEyy filenames", () => {
    const plan = buildPackageNormalizationPlan({
      title: "Breaking Bad",
      year: 2008,
      totalSeasons: 5,
      files: [
        file("Breaking.Bad.S01-S05.1080p/Season 01/Breaking.Bad.S01E01.mkv"),
        file("Breaking.Bad.S01-S05.1080p/Season 02/Breaking.Bad.S02E01.mkv"),
        file("Breaking.Bad.S01-S05.1080p/Season 03/Breaking.Bad.S03E01.mkv"),
        file("Breaking.Bad.S01-S05.1080p/Season 04/Breaking.Bad.S04E01.mkv"),
        file("Breaking.Bad.S01-S05.1080p/Season 05/Breaking.Bad.S05E01.mkv"),
      ],
    });

    expect(plan.coverage).toBe("complete_series_package");
    expect(plan.confidence).toBe("high");
    expect(plan.actions.map((action) => action.targetRelativePath)).toEqual([
      "Breaking Bad (2008)/Season 01/Breaking Bad.S01E01.mkv",
      "Breaking Bad (2008)/Season 02/Breaking Bad.S02E01.mkv",
      "Breaking Bad (2008)/Season 03/Breaking Bad.S03E01.mkv",
      "Breaking Bad (2008)/Season 04/Breaking Bad.S04E01.mkv",
      "Breaking Bad (2008)/Season 05/Breaking Bad.S05E01.mkv",
    ]);
  });

  it("uses Chinese season folders when filenames only expose episode numbers", () => {
    const plan = buildPackageNormalizationPlan({
      title: "绝命毒师",
      year: 2008,
      files: [
        file("绝命毒师 全五季/第1季/第01集.mkv"),
        file("绝命毒师 全五季/第二季/第03集.mkv"),
      ],
    });

    expect(plan.coverage).toBe("multi_season_package");
    expect(plan.confidence).toBe("medium");
    expect(plan.actions).toMatchObject([
      {
        episodeCode: "S01E01",
        targetRelativePath: "绝命毒师 (2008)/Season 01/绝命毒师.S01E01.mkv",
      },
      {
        episodeCode: "S02E03",
        targetRelativePath: "绝命毒师 (2008)/Season 02/绝命毒师.S02E03.mkv",
      },
    ]);
  });

  it("fails closed when files do not expose episode identity", () => {
    const plan = buildPackageNormalizationPlan({
      title: "Show",
      year: 2024,
      files: [
        file("Show.S01.1080p/Season 01/a8f7139c98.mkv"),
        file("Show.S01.1080p/Season 01/b6d42a16de.mkv"),
      ],
    });

    expect(plan.coverage).toBe("unknown");
    expect(plan.confidence).toBe("low");
    expect(plan.actions).toEqual([]);
    expect(plan.rejectedFiles).toMatchObject([
      { reason: "missing_episode" },
      { reason: "missing_episode" },
    ]);
  });

  it("marks duplicate episode mappings as unsafe instead of choosing one", () => {
    const plan = buildPackageNormalizationPlan({
      title: "Show",
      year: 2024,
      files: [
        file("Show.S01.1080p/Show.S01E01.1080p.mkv"),
        file("Show.S01.1080p/Show.S01E01.REPACK.mkv"),
      ],
    });

    expect(plan.confidence).toBe("low");
    expect(plan.actions).toEqual([]);
    expect(plan.rejectedFiles).toMatchObject([
      { reason: "duplicate_episode" },
      { reason: "duplicate_episode" },
    ]);
  });

  it("uses an agent recognition node for ambiguous package files before building the safe plan", async () => {
    const agents = new FakeAgentNodes({
      packageRecognition: {
        confidence: "medium",
        reason: "Parent folder order and visible episode labels map these files to season 1.",
        fileMappings: [
          {
            providerFileId: "provider_s1_e1",
            seasonNumber: 1,
            episodeNumber: 1,
            confidence: "medium",
            reason: "Episode 01 in Season One package folder.",
          },
          {
            providerFileId: "provider_s1_e2",
            seasonNumber: 1,
            episodeNumber: 2,
            confidence: "medium",
            reason: "Episode 02 in Season One package folder.",
          },
        ],
        rejectedProviderFileIds: [],
      },
    });

    const plan = await buildAgentAssistedPackageNormalizationPlan({
      title: "Show",
      year: 2024,
      agents,
      files: [
        {
          path: "Show Complete Pack/Disc A/Episode 01.mkv",
          sizeBytes: 100,
          providerFileId: "provider_s1_e1",
        },
        {
          path: "Show Complete Pack/Disc A/Episode 02.mkv",
          sizeBytes: 100,
          providerFileId: "provider_s1_e2",
        },
      ],
    });

    expect(plan.confidence).toBe("medium");
    expect(plan.actions.map((action) => action.targetRelativePath)).toEqual([
      "Show (2024)/Season 01/Show.S01E01.mkv",
      "Show (2024)/Season 01/Show.S01E02.mkv",
    ]);
    expect(plan.actions.every((action) => action.evidence.includes("agent_package_recognition"))).toBe(true);
  });
});

function file(path: string) {
  return {
    path,
    sizeBytes: 100,
    providerFileId: path,
  };
}

  it("surfaces agent-flagged foreign works as warnings without mapping them", async () => {
    const plan = await buildAgentAssistedPackageNormalizationPlan({
      title: "绝命毒师",
      year: 2008,
      files: [
        file("pack/绝命毒师 S01/Breaking.Bad.S01E01.mkv"),
        file("pack/续命之徒：绝命毒师电影/El.Camino.2019.mkv"),
      ],
      agents: {
        recognizePackage: async () => ({
          node: "test",
          fileMappings: [
            {
              providerFileId: "pack/绝命毒师 S01/Breaking.Bad.S01E01.mkv",
              seasonNumber: 1,
              episodeNumber: 1,
              confidence: "high",
              reason: "episode file",
            },
          ],
          rejectedProviderFileIds: ["pack/续命之徒：绝命毒师电影/El.Camino.2019.mkv"],
          foreignWorkProviderFileIds: ["pack/续命之徒：绝命毒师电影/El.Camino.2019.mkv"],
          confidence: "high",
          reason: "El Camino is a separate movie title",
        }),
      },
    });

    expect(plan.actions).toHaveLength(1);
    expect(plan.warnings.some((warning) => warning.includes("可能属于其他作品"))).toBe(true);
    expect(plan.warnings.some((warning) => warning.includes("El.Camino"))).toBe(true);
  });
