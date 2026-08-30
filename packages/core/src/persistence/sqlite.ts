import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

import initSqlJs from 'sql.js';
import type { Database, SqlValue } from 'sql.js';

export type SqliteValue = SqlValue;
export type SqliteParams = SqliteValue[] | Record<string, SqliteValue> | null;

export interface SqliteMigration {
  readonly version: number;
  readonly sql: string;
}

export interface SqliteStatement {
  readonly run: (sql: string, params?: SqliteParams) => void;
  readonly all: <T extends Record<string, SqliteValue>>(sql: string, params?: SqliteParams) => T[];
  readonly get: <T extends Record<string, SqliteValue>>(sql: string, params?: SqliteParams) => T | null;
  readonly exec: (sql: string) => void;
}

const require = createRequire(import.meta.url);
const processLocks = new Map<string, Promise<void>>();
const LOCK_TIMEOUT_MS = 30_000;
const LOCK_RETRY_MS = 25;

function lockKey(file: string): string {
  return path.resolve(file).toLowerCase();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueue<T>(file: string, operation: () => Promise<T>): Promise<T> {
  const key = lockKey(file);
  const previous = processLocks.get(key) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const tail = current.then(() => undefined, () => undefined);
  processLocks.set(key, tail);
  void tail.then(() => {
    if (processLocks.get(key) === tail) processLocks.delete(key);
  });
  return current;
}

async function acquireFileLock(file: string): Promise<fs.FileHandle> {
  const lock = `${file}.lock`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      const handle = await fs.open(lock, 'wx');
      await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
      return handle;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const stat = await fs.stat(lock);
        if (Date.now() - stat.mtimeMs > LOCK_TIMEOUT_MS) {
          await fs.rm(lock, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - started >= LOCK_TIMEOUT_MS) {
        throw new Error(`timed out waiting for SQLite lock: ${file}`);
      }
      await delay(LOCK_RETRY_MS);
    }
  }
}

async function releaseFileLock(handle: fs.FileHandle, file: string): Promise<void> {
  const lock = `${file}.lock`;
  await handle.close().catch(() => undefined);
  await fs.rm(lock, { force: true }).catch(() => undefined);
}

function rows<T extends Record<string, SqliteValue>>(database: Database, sql: string, params?: SqliteParams): T[] {
  const statement = database.prepare(sql, params ?? undefined);
  const result: T[] = [];
  try {
    while (statement.step()) result.push(statement.getAsObject() as T);
  } finally {
    statement.free();
  }
  return result;
}

function statementApi(database: Database): SqliteStatement {
  return {
    run: (sql, params) => {
      database.run(sql, params ?? undefined);
    },
    all: <T extends Record<string, SqliteValue>>(sql: string, params?: SqliteParams): T[] => rows<T>(database, sql, params),
    get: <T extends Record<string, SqliteValue>>(sql: string, params?: SqliteParams): T | null => rows<T>(database, sql, params)[0] ?? null,
    exec: (sql) => {
      database.exec(sql);
    },
  };
}

async function loadDatabase(file: string, Sqlite: Awaited<ReturnType<typeof initSqlJs>>): Promise<Database> {
  try {
    const bytes = await fs.readFile(file);
    return new Sqlite.Database(bytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return new Sqlite.Database();
  }
}

export class SqliteDatabase {
  readonly file: string;
  #database: Database;
  #migrations: readonly SqliteMigration[];
  #closed = false;

  private constructor(file: string, database: Database, migrations: readonly SqliteMigration[]) {
    this.file = path.resolve(file);
    this.#database = database;
    this.#migrations = migrations;
  }

  static async open(file: string, migrations: readonly SqliteMigration[] = []): Promise<SqliteDatabase> {
    const resolved = path.resolve(file);
    return enqueue(resolved, async () => {
      const lock = await acquireFileLock(resolved);
      try {
        const Sqlite = await initSqlJs({
          locateFile: (name) => require.resolve(`sql.js/dist/${name}`),
        });
        const database = await loadDatabase(resolved, Sqlite);
        const instance = new SqliteDatabase(resolved, database, migrations);
        await instance.#migrateUnlocked();
        await instance.#persistUnlocked();
        return instance;
      } finally {
        await releaseFileLock(lock, resolved);
      }
    });
  }

  async transaction<T>(operation: (database: SqliteStatement) => T | Promise<T>): Promise<T> {
    this.#assertOpen();
    return enqueue(this.file, async () => {
      const lock = await acquireFileLock(this.file);
      try {
        await this.#reloadUnlocked();
        this.#database.run('BEGIN IMMEDIATE');
        try {
          const result = await operation(statementApi(this.#database));
          this.#database.run('COMMIT');
          await this.#persistUnlocked();
          return result;
        } catch (error) {
          try {
            this.#database.run('ROLLBACK');
          } catch {
            this.#database = await this.#loadFreshUnlocked();
          }
          throw error;
        }
      } finally {
        await releaseFileLock(lock, this.file);
      }
    });
  }

  async read<T>(operation: (database: SqliteStatement) => T | Promise<T>): Promise<T> {
    this.#assertOpen();
    return enqueue(this.file, async () => {
      const lock = await acquireFileLock(this.file);
      try {
        await this.#reloadUnlocked();
        return await operation(statementApi(this.#database));
      } finally {
        await releaseFileLock(lock, this.file);
      }
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    await enqueue(this.file, async () => {
      if (this.#closed) return;
      const lock = await acquireFileLock(this.file);
      try {
        await this.#persistUnlocked();
        this.#database.close();
        this.#closed = true;
      } finally {
        await releaseFileLock(lock, this.file);
      }
    });
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error(`SQLite database is closed: ${this.file}`);
  }

  async #loadFreshUnlocked(): Promise<Database> {
    const Sqlite = await initSqlJs({
      locateFile: (name) => require.resolve(`sql.js/dist/${name}`),
    });
    return loadDatabase(this.file, Sqlite);
  }

  async #reloadUnlocked(): Promise<void> {
    const next = await this.#loadFreshUnlocked();
    this.#database.close();
    this.#database = next;
    await this.#migrateUnlocked();
  }

  async #migrateUnlocked(): Promise<void> {
    const current = Number(this.#database.exec('PRAGMA user_version')[0]?.values[0]?.[0] ?? 0);
    const migrations = [...this.#migrations].sort((left, right) => left.version - right.version);
    let version = current;
    this.#database.run('PRAGMA foreign_keys = ON');
    this.#database.run('PRAGMA busy_timeout = 5000');
    this.#database.run('PRAGMA journal_mode = WAL');
    for (const migration of migrations) {
      if (migration.version <= version) continue;
      this.#database.run('BEGIN');
      try {
        this.#database.exec(migration.sql);
        this.#database.run(`PRAGMA user_version = ${migration.version}`);
        this.#database.run('COMMIT');
        version = migration.version;
      } catch (error) {
        try {
          this.#database.run('ROLLBACK');
        } catch {
          this.#database = await this.#loadFreshUnlocked();
        }
        throw error;
      }
    }
  }

  async #persistUnlocked(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    let committed = false;
    try {
      await fs.writeFile(temporary, this.#database.export());
      await fs.rename(temporary, this.file);
      committed = true;
    } finally {
      if (!committed) await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
