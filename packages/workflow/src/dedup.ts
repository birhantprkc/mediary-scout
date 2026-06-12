import type { VerifiedFile } from "./domain.js";

export interface DedupPlan {
  /** episodeCode -> file ids (only episodes that actually have duplicates). */
  duplicateGroups: Record<string, string[]>;
  deleteFileIds: string[];
  keepFileIds: string[];
}

/**
 * Deterministic duplicate cleanup over a verified file snapshot.
 *
 * Skill rules made structural: file size is the ONLY criterion (larger =
 * better; "new" or "collection pack" never wins by itself), the sole file of
 * an episode can never be scheduled for deletion, and the plan is built from
 * one stable snapshot. Files whose episode could not be parsed never reach
 * this function — the executor does not surface them as VerifiedFile.
 */
export function buildDedupPlan(input: { files: VerifiedFile[] }): DedupPlan {
  const byEpisode = new Map<string, VerifiedFile[]>();
  for (const file of input.files) {
    const group = byEpisode.get(file.episodeCode) ?? [];
    group.push(file);
    byEpisode.set(file.episodeCode, group);
  }

  const duplicateGroups: Record<string, string[]> = {};
  const deleteFileIds: string[] = [];
  const keepFileIds: string[] = [];

  for (const [episodeCode, group] of byEpisode) {
    if (group.length === 1) {
      keepFileIds.push(group[0]!.id);
      continue;
    }
    duplicateGroups[episodeCode] = group.map((file) => file.id);
    let keeper = group[0]!;
    for (const candidate of group.slice(1)) {
      if (candidate.sizeBytes > keeper.sizeBytes) {
        keeper = candidate;
      }
    }
    keepFileIds.push(keeper.id);
    for (const file of group) {
      if (file.id !== keeper.id) {
        deleteFileIds.push(file.id);
      }
    }
  }

  return { duplicateGroups, deleteFileIds, keepFileIds };
}
