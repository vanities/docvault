import { expect, test, describe } from 'vite-plus/test';
import { parseJsonResponse, buildFileContent } from './base.js';

describe('parseJsonResponse', () => {
  test('parses plain JSON', () => {
    const result = parseJsonResponse('{"key": "value"}');
    expect(result).toEqual({ key: 'value' });
  });

  test('parses JSON wrapped in markdown code block', () => {
    const text = '```json\n{"key": "value"}\n```';
    const result = parseJsonResponse(text);
    expect(result).toEqual({ key: 'value' });
  });

  test('parses JSON wrapped in plain code block (no language)', () => {
    const text = '```\n{"key": "value"}\n```';
    const result = parseJsonResponse(text);
    expect(result).toEqual({ key: 'value' });
  });

  test('handles nested JSON objects', () => {
    const json = '{"a": {"b": [1, 2, 3]}, "c": true}';
    const text = `Here is the result:\n\`\`\`json\n${json}\n\`\`\``;
    const result = parseJsonResponse(text);
    expect(result).toEqual({ a: { b: [1, 2, 3] }, c: true });
  });

  test('throws on invalid JSON', () => {
    expect(() => parseJsonResponse('not json at all')).toThrow();
  });

  test('extracts JSON when preceded by explanatory text', () => {
    const text = 'Here is the parsed data:\n{"key": "value"}';
    const result = parseJsonResponse(text);
    expect(result).toEqual({ key: 'value' });
  });

  test('extracts JSON when preceded by a backtick character', () => {
    const text = '`{"key": "value"}`';
    const result = parseJsonResponse(text);
    expect(result).toEqual({ key: 'value' });
  });

  test('extracts JSON array preceded by text', () => {
    const text = 'Result: [1, 2, 3]';
    const result = parseJsonResponse(text);
    expect(result).toEqual([1, 2, 3]);
  });

  test('trims trailing text after closing brace', () => {
    const text = '{"key": "value"}\n\nNote: some extra text';
    const result = parseJsonResponse(text);
    expect(result).toEqual({ key: 'value' });
  });

  test('handles JSON with whitespace in code block', () => {
    const text = '```json\n  {\n    "key": "value"\n  }\n```';
    const result = parseJsonResponse(text);
    expect(result).toEqual({ key: 'value' });
  });

  test('parses JSON array', () => {
    const text = '```json\n[1, 2, 3]\n```';
    const result = parseJsonResponse(text);
    expect(result).toEqual([1, 2, 3]);
  });
});

describe('buildFileContent', () => {
  test('builds document block for PDF', () => {
    const block = buildFileContent({
      base64: 'base64data',
      mimeType: 'application/pdf',
      mediaType: 'application/pdf',
    });
    expect(block.type).toBe('document');
    expect(block.source.type).toBe('base64');
    expect(block.source.media_type).toBe('application/pdf');
    expect(block.source.data).toBe('base64data');
  });

  test('builds image block for JPEG', () => {
    const block = buildFileContent({
      base64: 'jpegdata',
      mimeType: 'image/jpeg',
      mediaType: 'image/jpeg',
    });
    expect(block.type).toBe('image');
    expect(block.source.media_type).toBe('image/jpeg');
  });

  test('builds image block for PNG', () => {
    const block = buildFileContent({
      base64: 'pngdata',
      mimeType: 'image/png',
      mediaType: 'image/png',
    });
    expect(block.type).toBe('image');
    expect(block.source.media_type).toBe('image/png');
  });

  test('builds image block for WebP', () => {
    const block = buildFileContent({
      base64: 'webpdata',
      mimeType: 'image/webp',
      mediaType: 'image/webp',
    });
    expect(block.type).toBe('image');
    expect(block.source.media_type).toBe('image/webp');
  });

  test('builds image block for GIF', () => {
    const block = buildFileContent({
      base64: 'gifdata',
      mimeType: 'image/gif',
      mediaType: 'image/gif',
    });
    expect(block.type).toBe('image');
    expect(block.source.media_type).toBe('image/gif');
  });
});
