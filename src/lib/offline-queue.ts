/**
 * Durable client-side queue for ball-by-ball writes.
 *
 * Tasks are persisted to IndexedDB before any network attempt, so they
 * survive page reloads, tab closes, and offline gaps longer than the
 * 30s in-memory retry budget. The scoreboard drains the queue serially:
 * each task is replayed via its registered runner, then deleted on
 * success.
 */

import { type IDBPDatabase, openDB } from "idb";

const DB_NAME = "hvc-score-queue";
const STORE = "tasks";
const VERSION = 1;

export type ScoreTaskKind = "recordBall" | "voidLastBall" | "voidLastN";

export type ScoreTask = {
  id?: number;
  matchId: string;
  kind: ScoreTaskKind;
  payload: unknown;
  createdAt: number;
};

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB unavailable in this environment");
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("byMatch", "matchId");
        }
      },
    });
  }
  return dbPromise;
}

export async function enqueueTask(task: Omit<ScoreTask, "id" | "createdAt">) {
  const db = await getDB();
  return db.add(STORE, { ...task, createdAt: Date.now() }) as Promise<number>;
}

export async function listTasksForMatch(matchId: string): Promise<ScoreTask[]> {
  const db = await getDB();
  const tx = db.transaction(STORE, "readonly");
  const idx = tx.store.index("byMatch");
  const results = (await idx.getAll(matchId)) as ScoreTask[];
  return results.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteTask(id: number) {
  const db = await getDB();
  await db.delete(STORE, id);
}

export async function countTasksForMatch(matchId: string): Promise<number> {
  const db = await getDB();
  const tx = db.transaction(STORE, "readonly");
  return tx.store.index("byMatch").count(matchId);
}
