import { episodeCode, episodeNumberFromCode } from "../domain.js";
import type { StorageExecutor } from "../ports.js";

/**
 * Phase 7b — sync the need. The whole product is a resource-sync problem:
 * compare what SHOULD exist (aired episodes per season, from TMDB) against what
 * REALLY exists (video files in each season's 115 directory), and the difference
 * is what's missing. Unaired episodes are NOT missing. Episodes present beyond
 * the aired cursor are provider-ahead (115 has them before TMDB caught up). The
 * need may span multiple seasons. No one defines the state by hand — sync computes
 * it. (see type-and-multiseason-model)
 */
export interface SeasonSyncInput {
  seasonNumber: number;
  /** Aired up to this episode (the should-exist range is E01..latestAiredEpisode). */
  latestAiredEpisode: number;
  /** This season's 115 directory id (must already be verify-or-created). */
  directoryId: string;
}

export interface SeasonNeedResult {
  /** Missing episode codes across all in-scope seasons (e.g. ["S01E07","S02E13"]). */
  missing: string[];
  /** Aired episodes already present. */
  obtained: string[];
  /** Episodes present in storage beyond the aired cursor (TMDB not caught up yet). */
  providerAhead: string[];
}

export async function syncSeasonNeed(input: {
  executor: Pick<StorageExecutor, "listVideoFiles">;
  seasons: SeasonSyncInput[];
}): Promise<SeasonNeedResult> {
  const missing: string[] = [];
  const obtained: string[] = [];
  const providerAhead: string[] = [];

  for (const season of input.seasons) {
    const files = await input.executor.listVideoFiles(season.directoryId);
    const have = new Set(
      files.map((file) => file.episodeCode).filter((code): code is string => code !== null),
    );
    // Should-exist = aired episodes only; unaired are NOT missing.
    for (let episode = 1; episode <= season.latestAiredEpisode; episode += 1) {
      const code = episodeCode(season.seasonNumber, episode);
      (have.has(code) ? obtained : missing).push(code);
    }
    // Provider-ahead = present beyond the aired cursor.
    for (const code of have) {
      if (episodeNumberFromCode(code) > season.latestAiredEpisode) {
        providerAhead.push(code);
      }
    }
  }
  return { missing, obtained, providerAhead };
}
