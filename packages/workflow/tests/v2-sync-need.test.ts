import { describe, expect, it } from "vitest";
import { syncSeasonNeed } from "../src/acquisition-v2/sync-need.js";
import { FakeStorageExecutor } from "../src/fakes.js";
import type { VerifiedFile } from "../src/domain.js";

function vf(directoryId: string, code: string): VerifiedFile {
  return {
    id: `f_${directoryId}_${code}`,
    storageDirectoryId: directoryId,
    name: `${code}.mkv`,
    sizeBytes: 1_000,
    episodeCode: code,
    providerFileId: `p_${code}`,
  };
}

describe("syncSeasonNeed — 应有 vs 实有 = 缺什么", () => {
  it("missing = aired episodes not present in the season directory", async () => {
    const executor = new FakeStorageExecutor({
      directories: { s1: [vf("s1", "S01E01"), vf("s1", "S01E02"), vf("s1", "S01E03")] },
    });
    const result = await syncSeasonNeed({
      executor,
      seasons: [{ seasonNumber: 1, latestAiredEpisode: 5, directoryId: "s1" }],
    });
    expect(result.missing).toEqual(["S01E04", "S01E05"]);
    expect(result.obtained).toEqual(["S01E01", "S01E02", "S01E03"]);
  });

  it("computes a CROSS-SEASON missing set (need can span seasons)", async () => {
    const executor = new FakeStorageExecutor({
      directories: {
        s1: [vf("s1", "S01E01"), vf("s1", "S01E02")], // complete
        s2: [vf("s2", "S02E01")], // missing S02E02, S02E03
      },
    });
    const result = await syncSeasonNeed({
      executor,
      seasons: [
        { seasonNumber: 1, latestAiredEpisode: 2, directoryId: "s1" },
        { seasonNumber: 2, latestAiredEpisode: 3, directoryId: "s2" },
      ],
    });
    expect(result.missing).toEqual(["S02E02", "S02E03"]); // only season 2's gap
  });

  it("unaired episodes are NOT missing; episodes beyond the aired cursor are provider-ahead", async () => {
    const executor = new FakeStorageExecutor({
      directories: { s1: [vf("s1", "S01E01"), vf("s1", "S01E02"), vf("s1", "S01E03")] },
    });
    const result = await syncSeasonNeed({
      executor,
      // aired only up to E02; E03 exists in storage but is ahead of TMDB
      seasons: [{ seasonNumber: 1, latestAiredEpisode: 2, directoryId: "s1" }],
    });
    expect(result.missing).toEqual([]); // E03 unaired → not missing
    expect(result.providerAhead).toEqual(["S01E03"]);
  });
});
