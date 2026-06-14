import "server-only";
import pg from "pg";
import type { Pool } from "pg";
import type { MediaSearchCache, MediaSearchCandidate } from "@media-track/workflow";

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h: TMDB search results barely change
const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // reclaim dead rows at most every 10 min

/**
 * Durable TMDB search cache (tier 2 of the read path: tracked state -> this
 * cache -> live TMDB only on a miss). Survives restarts so casual searching
 * never becomes a TMDB API storm.
 *
 * A cache is just a fast store of expensive results, defined by three choices:
 *
 *  1. KEY — what identifies a request. Here: the normalized search query.
 *  2. FRESHNESS (TTL) — how long a stored result counts as still-good. Past its
 *     `expires_at` the row is STALE and must be re-fetched from TMDB. 6h here.
 *  3. EVICTION — how stale rows are removed. Two complementary mechanisms:
 *     - LAZY (on read): when we look up a key and it's expired, treat it as a
 *       miss and delete it. Cheap — only touches keys we actually read.
 *     - ACTIVE SWEEP (background): a row nobody ever reads again would linger
 *       forever, so a periodic `DELETE WHERE expired` reclaims it. Run on a time
 *       guard (at most once per interval), NOT on every write.
 *
 * No size cap / LRU is needed: the TTL plus the bounded set of distinct queries
 * keep the table naturally small (≈ "queries seen in the last 6h").
 */
export class PostgresMediaSearchCache implements MediaSearchCache {
  private readonly pool: Pool;
  private readonly ttlMs: number;
  private schemaReady: Promise<void> | undefined;
  private lastSweepAt = 0;

  constructor(options: { connectionString: string; ttlMs?: number }) {
    this.pool = new pg.Pool({ connectionString: options.connectionString });
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  async get(query: string): Promise<MediaSearchCandidate[] | null> {
    await this.ensureSchema();
    const key = normalizeKey(query);
    const result = await this.pool.query<{ payload: MediaSearchCandidate[]; expires_at: Date }>(
      "SELECT payload, expires_at FROM tmdb_search_cache WHERE cache_key = $1",
      [key],
    );
    const row = result.rows[0];
    if (!row) {
      return null; // cold miss
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      // Stale — evict lazily on read, then report a miss so the caller re-fetches.
      await this.pool.query("DELETE FROM tmdb_search_cache WHERE cache_key = $1 AND expires_at <= now()", [key]);
      return null;
    }
    return row.payload;
  }

  async set(query: string, candidates: MediaSearchCandidate[]): Promise<void> {
    await this.ensureSchema();
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await this.pool.query(
      `INSERT INTO tmdb_search_cache (cache_key, payload, expires_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at`,
      [normalizeKey(query), JSON.stringify(candidates), expiresAt],
    );
    await this.sweepExpiredOccasionally();
  }

  private ensureSchema(): Promise<void> {
    return (this.schemaReady ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS tmdb_search_cache (
           cache_key text PRIMARY KEY,
           payload jsonb NOT NULL,
           expires_at timestamptz NOT NULL
         );
         CREATE INDEX IF NOT EXISTS tmdb_search_cache_expires_at_idx ON tmdb_search_cache (expires_at);`,
      )
      .then(() => undefined));
  }

  // Active eviction: drop rows no reader will ever expire lazily. Time-guarded
  // so it costs one bounded DELETE per interval, not one per write.
  private async sweepExpiredOccasionally(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) {
      return;
    }
    this.lastSweepAt = now;
    await this.pool.query("DELETE FROM tmdb_search_cache WHERE expires_at < now()");
  }
}

function normalizeKey(query: string): string {
  return query.trim().toLowerCase();
}
