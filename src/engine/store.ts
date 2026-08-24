import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GameState } from "./state";

/**
 * Session persistence port.
 *
 * The design calls for Postgres; this interface is the seam. The file-backed
 * adapter below keeps the vertical slice runnable with no infrastructure, which
 * matters more in Phase 0 than durability does. A Drizzle/Postgres adapter
 * implements the same three methods and nothing above this line changes.
 */
export interface SessionStore {
  save(state: GameState): Promise<void>;
  load(sessionId: string): Promise<GameState | null>;
  list(): Promise<GameState[]>;
}

const SESSION_DIR = process.env.SESSION_DIR ?? ".sessions";

/** Reject anything that could escape the session directory. */
function assertSafeId(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error(`Unsafe session id: ${JSON.stringify(id)}`);
  }
}

export class FileSessionStore implements SessionStore {
  constructor(private readonly dir: string = SESSION_DIR) {}

  private path(id: string): string {
    assertSafeId(id);
    return join(this.dir, `${id}.json`);
  }

  async save(state: GameState): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path(state.session_id), JSON.stringify(state, null, 2));
  }

  async load(sessionId: string): Promise<GameState | null> {
    const p = this.path(sessionId);
    if (!existsSync(p)) return null;
    return GameState.parse(JSON.parse(readFileSync(p, "utf8")));
  }

  async list(): Promise<GameState[]> {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => GameState.parse(JSON.parse(readFileSync(join(this.dir, f), "utf8"))))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
}

/** In-memory adapter, for tests. */
export class MemorySessionStore implements SessionStore {
  private readonly map = new Map<string, GameState>();

  async save(state: GameState): Promise<void> {
    this.map.set(state.session_id, state);
  }

  async load(sessionId: string): Promise<GameState | null> {
    return this.map.get(sessionId) ?? null;
  }

  async list(): Promise<GameState[]> {
    return [...this.map.values()].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    );
  }
}

let singleton: SessionStore | null = null;

export function getStore(): SessionStore {
  singleton ??= new FileSessionStore();
  return singleton;
}

/** Test hook. */
export function setStore(store: SessionStore): void {
  singleton = store;
}
