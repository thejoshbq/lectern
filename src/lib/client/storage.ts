"use client";

/**
 * Conversation history, stored in the browser.
 *
 * Sessions are anonymous and the server is stateless. What someone brings here
 * — their confessions, their fears, their prayers for their marriage — stays
 * on their own machine. There is no account to create and nothing to delete
 * from a server later, because nothing was sent there to begin with.
 */

import type { ClientResult } from "../agent/serialize";

const DB_NAME = "lectern";
const LEGACY_DB_NAME = "ghost";
const DB_VERSION = 1;
const STORE = "conversations";

export interface StoredTurn {
  id: string;
  request: string;
  result: ClientResult;
  at: number;
}

export interface Conversation {
  id: string;
  title: string;
  turns: StoredTurn[];
  createdAt: number;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Opens a database only if it already exists, so a missing legacy store is not created. */
function openExisting(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) request.transaction?.abort();
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

let migrated: Promise<void> | null = null;

/** Copies conversations from the previous database name once, if Lectern is empty. */
function migrateFromLegacy(): Promise<void> {
  migrated ??= (async () => {
    const legacy = await openExisting(LEGACY_DB_NAME);
    if (!legacy) return;

    try {
      if (!legacy.objectStoreNames.contains(STORE)) return;

      const rows = await new Promise<Conversation[]>((resolve, reject) => {
        const tx = legacy.transaction(STORE, "readonly");
        const request = tx.objectStore(STORE).getAll();
        request.onsuccess = () =>
          resolve((request.result as Conversation[]) ?? []);
        request.onerror = () => reject(request.error);
      });
      if (rows.length === 0) return;

      const current = await transact<Conversation[]>("readonly", (store) =>
        store.getAll() as IDBRequest<Conversation[]>,
      );
      if (current.length > 0) return;

      const db = await openDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          for (const row of rows) tx.objectStore(STORE).put(row);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    } finally {
      legacy.close();
    }
  })().catch(() => {
    // A failed copy costs history from the old name, not the current session.
  });
  return migrated;
}

/** Private browsing and blocked storage should degrade, not crash. */
function available(): boolean {
  return typeof indexedDB !== "undefined";
}

export async function listConversations(): Promise<Conversation[]> {
  if (!available()) return [];
  try {
    await migrateFromLegacy();
    const all = await transact<Conversation[]>("readonly", (store) =>
      store.getAll() as IDBRequest<Conversation[]>,
    );
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function getConversation(id: string): Promise<Conversation | null> {
  if (!available()) return null;
  try {
    await migrateFromLegacy();
    const found = await transact<Conversation | undefined>("readonly", (store) =>
      store.get(id) as IDBRequest<Conversation | undefined>,
    );
    return found ?? null;
  } catch {
    return null;
  }
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  if (!available()) return;
  try {
    await migrateFromLegacy();
    await transact("readwrite", (store) => store.put(conversation));
  } catch {
    // Storage being unavailable costs history, not the conversation in progress.
  }
}

export async function deleteConversation(id: string): Promise<void> {
  if (!available()) return;
  try {
    await migrateFromLegacy();
    await transact("readwrite", (store) => store.delete(id));
  } catch {
    // Ignore.
  }
}

export function newConversationId(): string {
  return crypto.randomUUID();
}

/** A short label for the sidebar, taken from the opening request. */
export function titleFrom(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 48) return cleaned;
  return cleaned.slice(0, 47).replace(/\s\S*$/, "") + "…";
}
