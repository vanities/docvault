import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { describe, expect, test } from 'vite-plus/test';
import {
  createYouTubeTranscriptFetcher,
  selectEnglishCaption,
  type YtDlpProcessResult,
} from './youtube-transcript';

const FIRST = 'abcdefghijk';
const SECOND = 'lmnopqrstuv';
const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nSynthetic research transcript.\n';

function harness(failures: YtDlpProcessResult[] = []) {
  let clock = Date.parse('2026-06-01T12:00:00Z');
  const commands: string[][] = [];
  const delays: number[] = [];
  let active = 0;
  let maxActive = 0;
  const fetch = createYouTubeTranscriptFetcher({
    now: () => clock,
    random: () => 0.5,
    sleep: async (ms) => {
      delays.push(ms);
      clock += ms;
    },
    run: async (cmd) => {
      commands.push(cmd);
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        await Promise.resolve();
        if (cmd.includes('--dump-single-json')) {
          const id = cmd.at(-1)!.split('v=')[1];
          return {
            exitCode: 0,
            stderr: '',
            stdout: JSON.stringify({
              id,
              title: 'Example video',
              channel: 'Example channel',
              automatic_captions: { 'en-orig': [{}], en: [{}], 'en-US': [{}] },
            }),
          };
        }
        const failure = failures.shift();
        if (failure) return failure;
        const infoPath = cmd[cmd.indexOf('--load-info-json') + 1];
        const meta = JSON.parse(await readFile(infoPath, 'utf8'));
        await writeFile(path.join(path.dirname(infoPath), `${meta.id}.en-orig.vtt`), vtt);
        return { exitCode: 0, stderr: '', stdout: '' };
      } finally {
        active--;
      }
    },
  });
  return {
    fetch,
    commands,
    delays,
    advance: (ms: number) => {
      clock += ms;
    },
    maxActive: () => maxActive,
  };
}

describe('YouTube caption collection', () => {
  test('prefers uploaded English over translated auto-caption variants', () => {
    expect(
      selectEnglishCaption({
        id: FIRST,
        subtitles: { en: [{}] },
        automatic_captions: { 'en-orig': [{}], 'en-US': [{}] },
      })
    ).toEqual({ language: 'en', automatic: false });
    expect(
      selectEnglishCaption({ id: FIRST, automatic_captions: { en: [{}], 'en-orig': [{}] } })
    ).toEqual({ language: 'en-orig', automatic: true });
  });

  test('retries a transient caption failure using the same metadata and one English track', async () => {
    const h = harness([
      {
        exitCode: 1,
        stdout: '',
        stderr: 'ERROR: Unable to download video subtitles: HTTP Error 503',
      },
    ]);
    const result = await h.fetch(FIRST);
    expect(result.text).toContain('Synthetic research transcript');
    expect(h.commands.filter((c) => c.includes('--dump-single-json'))).toHaveLength(1);
    const captions = h.commands.filter((c) => c.includes('--load-info-json'));
    expect(captions).toHaveLength(2);
    expect(captions[0][captions[0].indexOf('--sub-langs') + 1]).toBe('^en-orig$');
    expect(captions[0]).toContain('deno');
    expect(h.delays).toContain(5000);
  });

  test('serializes different channel requests and coalesces duplicate videos', async () => {
    const h = harness();
    const [first, duplicate, second] = await Promise.all([
      h.fetch(FIRST),
      h.fetch(`https://youtu.be/${FIRST}`),
      h.fetch(SECOND),
    ]);
    expect(first).toBe(duplicate);
    expect(second.videoId).toBe(SECOND);
    expect(h.commands).toHaveLength(4);
    expect(h.maxActive()).toBe(1);
    expect(h.delays.filter((ms) => ms >= 3000).length).toBeGreaterThanOrEqual(3);
  });

  test('a 429 pauses every channel without repeated requests, then allows recovery', async () => {
    const h = harness([
      { exitCode: 1, stdout: '', stderr: 'ERROR: HTTP Error 429: Too Many Requests' },
    ]);
    await expect(h.fetch(FIRST)).rejects.toMatchObject({
      code: 'rate-limited',
      attempts: 1,
      retryAt: expect.any(String),
    });
    await expect(h.fetch(SECOND)).rejects.toMatchObject({ code: 'rate-limited', attempts: 0 });
    expect(h.commands).toHaveLength(2);
    h.advance(15 * 60 * 1000);
    expect((await h.fetch(SECOND)).videoId).toBe(SECOND);
    expect(h.commands).toHaveLength(4);
  });

  test('does not repeatedly request a permanently unavailable video', async () => {
    const h = harness([{ exitCode: 1, stdout: '', stderr: 'ERROR: Private video' }]);
    await expect(h.fetch(FIRST)).rejects.toMatchObject({
      code: 'unavailable',
      retryable: false,
      attempts: 1,
    });
    expect(h.commands).toHaveLength(2);
  });

  test('bounds retries for repeated timeouts', async () => {
    const h = harness(
      Array.from({ length: 3 }, () => ({ exitCode: null, stdout: '', stderr: '', timedOut: true }))
    );
    await expect(h.fetch(FIRST)).rejects.toMatchObject({ code: 'timeout', attempts: 3 });
    expect(h.commands).toHaveLength(4);
    expect(h.delays).toContain(10000);
  });
});
