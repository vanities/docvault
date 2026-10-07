// Reconstructed synthetic media-detection coverage for the pre-existing ignored test.
// Binary headers and filenames below are fabricated; no media files are read.
import { describe, expect, test, vi } from 'vite-plus/test';
vi.mock('../data.js', () => ({
  DATA_DIR: '/tmp/docvault-media-test',
  ensureDir: vi.fn(),
  jsonResponse: vi.fn(),
}));
vi.mock('../parsers/research-report.js', () => ({
  RESEARCH_EXTRACTOR_VERSION: 'synthetic',
  extractResearchText: vi.fn(),
}));
vi.mock('../parsers/youtube-transcript.js', () => ({
  YOUTUBE_EXTRACTOR_VERSION: 'synthetic',
  extractVideoId: vi.fn(),
  fetchYouTubeTranscript: vi.fn(),
}));
vi.mock('../parsers/media-transcribe.js', () => ({
  MEDIA_TRANSCRIBE_EXTRACTOR_VERSION: 'synthetic',
  transcribeMediaFile: vi.fn(),
}));
vi.mock('../politics/feed-store.js', () => ({ loadPoliticsFeedPayload: vi.fn() }));
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    timer: () => () => 0,
  }),
}));
import { detectMediaType } from './research.js';

const ftyp = (brand: string) => Buffer.from('0000ftyp' + brand);
const ebml = (doctype: string) =>
  Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from(doctype)]);
describe('detectMediaType', () => {
  test('recognizes MP4 from its ISO container header', () => {
    expect(detectMediaType(ftyp('isom'), null)).toEqual({
      mediaType: 'video/mp4',
      extension: 'mp4',
    });
  });
  test('recognizes QuickTime from its brand', () => {
    expect(detectMediaType(ftyp('qt  '), null)).toEqual({
      mediaType: 'video/quicktime',
      extension: 'mov',
    });
  });
  test('recognizes M4A from its brand', () => {
    expect(detectMediaType(ftyp('M4A '), null)).toEqual({
      mediaType: 'audio/mp4',
      extension: 'm4a',
    });
  });
  test('uses an M4A filename for an ambiguous ISO container', () => {
    expect(detectMediaType(ftyp('isom'), 'synthetic.m4a')).toEqual({
      mediaType: 'audio/mp4',
      extension: 'm4a',
    });
  });
  test('uses a MOV filename for an ambiguous ISO container', () => {
    expect(detectMediaType(ftyp('isom'), 'synthetic.mov')).toEqual({
      mediaType: 'video/quicktime',
      extension: 'mov',
    });
  });
  test('recognizes a Matroska EBML header', () => {
    expect(detectMediaType(ebml('matroska'), null)).toEqual({
      mediaType: 'video/x-matroska',
      extension: 'mkv',
    });
  });
  test('distinguishes WebM by its EBML document type', () => {
    expect(detectMediaType(ebml('webm'), null)).toEqual({
      mediaType: 'video/webm',
      extension: 'webm',
    });
  });
  test('recognizes MP3 ID3 tags', () => {
    expect(detectMediaType(Buffer.from('ID3'), null)).toEqual({
      mediaType: 'audio/mpeg',
      extension: 'mp3',
    });
  });
  test('recognizes MP3 frame synchronization bytes', () => {
    expect(detectMediaType(Buffer.from([0xff, 0xfb]), null)).toEqual({
      mediaType: 'audio/mpeg',
      extension: 'mp3',
    });
  });
  test('recognizes WAV with both RIFF and WAVE markers', () => {
    expect(detectMediaType(Buffer.from('RIFF0000WAVE'), null)).toEqual({
      mediaType: 'audio/wav',
      extension: 'wav',
    });
  });
  test('falls back to supported filename extensions, ignoring case', () => {
    const formats = {
      mp4: 'video/mp4',
      m4v: 'video/mp4',
      mov: 'video/quicktime',
      mkv: 'video/x-matroska',
      webm: 'video/webm',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      wav: 'audio/wav',
      weba: 'audio/webm',
    };
    for (const [extension, mediaType] of Object.entries(formats)) {
      expect(
        detectMediaType(Buffer.from('synthetic bytes'), `SYNTHETIC.${extension.toUpperCase()}`)
      ).toEqual({ mediaType, extension });
    }
  });
  test('rejects a PDF as a video or audio upload', () => {
    expect(detectMediaType(Buffer.from('%PDF-synthetic'), 'synthetic.pdf')).toBeNull();
  });
  test('rejects empty or unknown media without a supported extension', () => {
    expect(detectMediaType(Buffer.alloc(0), null)).toBeNull();
    expect(detectMediaType(Buffer.from('synthetic'), 'synthetic.txt')).toBeNull();
  });
});
