import type { StorageExecutor } from "../ports.js";

/**
 * Phase 7a — directory lifecycle. Before the agent runs, the system ensures the
 * 115 directory tree exists and hands the agent scoped handles. Every level is
 * verify-or-create: a directory the DB thinks exists may have been deleted by
 * the user, so we go through createDirectory (find-or-create) which lists the
 * parent for the name and reuses it if present, recreates it if gone. The cid is
 * never trusted blindly — the directory is verified like a resource is.
 *
 * Staging lives UNDER the show directory, never inside a Season directory (a
 * recursive lister would otherwise leak isolated files as "obtained").
 */
export interface AcquisitionDirectories {
  showDirectoryId: string;
  /** season number -> its scoped Season directory id. */
  seasonDirectoryIds: Record<number, string>;
  stagingDirectoryId: string;
}

export interface EnsureSeasonDirectoriesRequest {
  executor: Pick<StorageExecutor, "createDirectory">;
  /** Library category parent (Movies/TV/Anime), chosen by title.type upstream. */
  categoryParentId: string;
  showName: string;
  year: number;
  /** The season number(s) this task covers (one, several, or all). */
  seasons: number[];
  /** Run-scoped suffix so each run gets its own staging dir under the show dir. */
  workflowRunId: string;
}

export async function ensureSeasonAcquisitionDirectories(
  request: EnsureSeasonDirectoriesRequest,
): Promise<AcquisitionDirectories> {
  // Show dir under the category. find-or-create = verify-or-create: reused if it
  // exists, recreated if the user deleted it.
  const showDirectoryId = await request.executor.createDirectory({
    name: `${request.showName} (${request.year})`,
    parentId: request.categoryParentId,
  });
  // Each requested season's Season NN directory under the show dir.
  const seasonDirectoryIds: Record<number, string> = {};
  for (const season of request.seasons) {
    seasonDirectoryIds[season] = await request.executor.createDirectory({
      name: `Season ${String(season).padStart(2, "0")}`,
      parentId: showDirectoryId,
    });
  }
  // Staging UNDER the show dir (never inside a Season dir).
  const stagingDirectoryId = await request.executor.createDirectory({
    name: `staging-${request.workflowRunId}`,
    parentId: showDirectoryId,
  });
  return { showDirectoryId, seasonDirectoryIds, stagingDirectoryId };
}
