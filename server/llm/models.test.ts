// Synthetic model ids and an isolated tmpdir cache; never touches NAS data,
// the logs dir, or the network.
import { afterAll, beforeEach, expect, test, vi } from 'vite-plus/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  dataDir: '',
  openaiList: vi.fn(),
  anthropicList: vi.fn(),
  openaiConfig: vi.fn(),
}));
vi.mock('openai', () => ({
  default: class {
    models = { list: mocks.openaiList };
  },
}));
vi.mock('../parsers/base.js', () => ({
  getClient: async () => ({ models: { list: mocks.anthropicList } }),
}));
vi.mock('../data.js', () => ({
  get DATA_DIR() {
    return mocks.dataDir;
  },
  getOpenAIConfig: mocks.openaiConfig,
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    timer: () => () => 0,
  }),
}));

mocks.dataDir = await mkdtemp(path.join(tmpdir(), 'docvault-models-test-'));
const cacheFile = path.join(mocks.dataDir, '.docvault-model-cache.json');
const { listModels } = await import('./models');

const OPENAI_IDS = [
  'gpt-5.5',
  'gpt-4o-mini',
  'gpt-image-3', // a future release under today's naming
  'gpt-6-image', // ...and under a naming scheme nobody has shipped yet
  'gpt-image-2',
  'gpt-image-2.5-flare',
  'gpt-image-1-mini',
  'chatgpt-image-latest',
  'dall-e-3',
  'sora-2',
  'text-embedding-3-large',
  'gpt-4o-mini-tts',
  'whisper-1',
];

beforeEach(async () => {
  await rm(cacheFile, { force: true });
  mocks.openaiList.mockReset();
  mocks.anthropicList.mockReset();
  mocks.openaiConfig.mockReset();
  mocks.openaiConfig.mockResolvedValue({ apiKey: 'sk-test' });
  mocks.openaiList.mockResolvedValue({ data: OPENAI_IDS.map((id) => ({ id })) });
});
afterAll(async () => {
  await rm(mocks.dataDir, { force: true, recursive: true });
});

test('lists OpenAI image models instead of losing them to the chat filter', async () => {
  const res = await listModels('openai');
  expect(res.source).toBe('live');
  // Newest-named first; video (sora), embedding, tts, and whisper ids stay out.
  expect(res.imageModels).toEqual([
    'gpt-image-3',
    'gpt-image-2.5-flare',
    'gpt-image-2',
    'gpt-image-1-mini',
    'gpt-6-image',
    'dall-e-3',
    'chatgpt-image-latest',
  ]);
  // Disjoint from the image list: no image model leaks into the chat pickers.
  expect(res.models).toEqual(['gpt-5.5', 'gpt-4o-mini']);
});

test('refetches a cache entry written before image listing instead of serving it', async () => {
  await writeFile(
    cacheFile,
    JSON.stringify({ openai: { models: ['gpt-5.5'], fetchedAt: Date.now() } })
  );
  const res = await listModels('openai');
  expect(res.source).toBe('live');
  expect(res.imageModels).toContain('gpt-image-2');
  expect(mocks.openaiList).toHaveBeenCalledTimes(1);
});

test('serves a fresh cache entry, image models included, without calling OpenAI', async () => {
  await listModels('openai');
  const second = await listModels('openai');
  expect(second.source).toBe('cache');
  expect(second.imageModels).toContain('gpt-image-2.5-flare');
  expect(mocks.openaiList).toHaveBeenCalledTimes(1);
});

test('falls back to known image models when no OpenAI key is configured', async () => {
  mocks.openaiConfig.mockResolvedValue({});
  const res = await listModels('openai');
  expect(res.source).toBe('fallback');
  expect(res.imageModels).toContain('gpt-image-2');
  expect(mocks.openaiList).not.toHaveBeenCalled();
});

test('Anthropic lists no image models', async () => {
  mocks.anthropicList.mockResolvedValue({ data: [{ id: 'claude-test-1' }, { id: 'other-1' }] });
  expect(await listModels('anthropic')).toEqual({
    models: ['claude-test-1'],
    imageModels: [],
    source: 'live',
  });
});

test('a local OpenAI-compatible server lists every model in both pickers', async () => {
  // Local ids (Ollama/vLLM/LocalAI) follow no naming scheme, so nothing is filtered.
  mocks.openaiConfig.mockResolvedValue({ apiKey: 'sk-test', baseUrl: 'http://localhost:8080/v1' });
  mocks.openaiList.mockResolvedValue({ data: [{ id: 'llama-local' }, { id: 'sdxl-local' }] });
  const res = await listModels('openai');
  expect(res.models).toEqual(['sdxl-local', 'llama-local']);
  expect(res.imageModels).toEqual(['sdxl-local', 'llama-local']);
});
