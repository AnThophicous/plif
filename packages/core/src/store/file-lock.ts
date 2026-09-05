import fs from 'node:fs/promises';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Small cross-process mutex based on an atomic lock-directory creation. */
export async function withFileLock<T>(target: string, work: () => Promise<T>): Promise<T> {
  const lock = `${target}.lock`;
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      await fs.mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const stat = await fs.stat(lock).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 30_000) {
        await fs.rm(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`timed out waiting for lock ${lock}`);
      await wait(10);
    }
  }
  try {
    return await work();
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}
