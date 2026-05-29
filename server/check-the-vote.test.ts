import { describe, expect, test } from 'vite-plus/test';
import { buildCheckTheVoteHeaders, getCheckTheVoteConfig } from './check-the-vote';

describe('getCheckTheVoteConfig', () => {
  test('returns disabled config when base URL or API key is missing', () => {
    expect(getCheckTheVoteConfig({}).configured).toBe(false);
    expect(
      getCheckTheVoteConfig({ CHECKTHEVOTE_BASE_URL: 'http://pi.local:3000' }).configured
    ).toBe(false);
    expect(getCheckTheVoteConfig({ CHECKTHEVOTE_API_KEY: 'secret' }).configured).toBe(false);
  });

  test('normalizes configured base URL by trimming trailing slashes', () => {
    const config = getCheckTheVoteConfig({
      CHECKTHEVOTE_BASE_URL: 'http://pi.local:3000///',
      CHECKTHEVOTE_API_KEY: 'secret',
    });

    expect(config).toEqual({
      configured: true,
      baseUrl: 'http://pi.local:3000',
      apiKey: 'secret',
    });
  });
});

describe('buildCheckTheVoteHeaders', () => {
  test('builds bearer authorization header without exposing the key elsewhere', () => {
    expect(buildCheckTheVoteHeaders('secret')).toEqual({
      accept: 'application/json',
      authorization: 'Bearer secret',
    });
  });
});
