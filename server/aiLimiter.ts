// Shared AI rate-limit protection: concurrency limiter + retry with backoff

import { createLogger } from './logger.js';

const log = createLogger('AI');

const MAX_CONCURRENT = 2;
const MAX_RETRIES = 3;

let inFlight = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    queue.push(() => {
      inFlight++;
      resolve();
    });
  });
}

function release(): void {
  inFlight--;
  const next = queue.shift();
  if (next) next();
}

async function retryOn429<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const error = err as {
        status?: number;
        error?: { status?: number };
        headers?: Record<string, string>;
      };
      const status = error.status ?? error.error?.status;
      if (status !== 429 || attempt === MAX_RETRIES) throw err;

      const retryAfter = Number(error.headers?.['retry-after']) || 0;
      const delay = retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
      log.info(`429 — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

export async function withAILimit<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await retryOn429(fn);
  } finally {
    release();
  }
}
