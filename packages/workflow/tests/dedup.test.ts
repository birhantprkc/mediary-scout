import { describe, expect, it } from "vitest";
import { buildDedupPlan, type VerifiedFile } from "../src/index.js";

function file(id: string, episodeCode: string, sizeBytes: number): VerifiedFile {
  return {
    id,
    storageDirectoryId: "dir_1",
    name: `${id}.mkv`,
    sizeBytes,
    episodeCode,
    providerFileId: id,
  };
}

describe("buildDedupPlan", () => {
  it("keeps the larger file regardless of which transfer brought it (生命树 lesson)", () => {
    const plan = buildDedupPlan({
      files: [
        file("old_e01", "S01E01", 1_200_000_000),
        file("new_e01", "S01E01", 800_000_000),
        file("old_e02", "S01E02", 1_200_000_000),
        file("new_e02", "S01E02", 800_000_000),
        file("only_e13", "S01E13", 800_000_000),
      ],
    });

    expect(plan.deleteFileIds).toEqual(["new_e01", "new_e02"]);
    expect(plan.keepFileIds).toContain("old_e01");
    expect(plan.keepFileIds).toContain("only_e13");
    expect(plan.duplicateGroups).toEqual({
      S01E01: ["old_e01", "new_e01"],
      S01E02: ["old_e02", "new_e02"],
    });
  });

  it("never deletes the sole file of an episode", () => {
    const plan = buildDedupPlan({
      files: [file("a", "S01E01", 1), file("b", "S01E02", 1)],
    });

    expect(plan.deleteFileIds).toEqual([]);
    expect(plan.keepFileIds).toEqual(["a", "b"]);
    expect(plan.duplicateGroups).toEqual({});
  });

  it("breaks size ties by keeping the first file", () => {
    const plan = buildDedupPlan({
      files: [file("first", "S01E01", 1_000), file("second", "S01E01", 1_000)],
    });

    expect(plan.keepFileIds).toEqual(["first"]);
    expect(plan.deleteFileIds).toEqual(["second"]);
  });

  it("handles three-way duplicates keeping only the largest", () => {
    const plan = buildDedupPlan({
      files: [
        file("small", "S01E05", 500),
        file("large", "S01E05", 5_000),
        file("medium", "S01E05", 1_000),
      ],
    });

    expect(plan.keepFileIds).toEqual(["large"]);
    expect(plan.deleteFileIds.sort()).toEqual(["medium", "small"]);
  });
});
