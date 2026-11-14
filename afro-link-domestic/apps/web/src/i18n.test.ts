import { describe, expect, it } from 'vitest';
import { LANGUAGES, STRINGS } from './i18n';

describe('i18n', () => {
  it('defines every key in every supported language', () => {
    const en = Object.keys(STRINGS.en).sort();
    for (const { code } of LANGUAGES) {
      const keys = Object.keys(STRINGS[code]).sort();
      expect(keys, `language ${code}`).toEqual(en);
    }
  });

  it('keeps non-empty strings everywhere', () => {
    for (const strings of Object.values(STRINGS)) {
      for (const [key, value] of Object.entries(strings)) {
        expect(value.trim(), `key ${key}`).not.toBe('');
      }
    }
  });

  it('exposes six languages with distinct labels', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'am', 'om', 'so', 'ti', 'sw']);
    expect(new Set(LANGUAGES.map((l) => l.label)).size).toBe(LANGUAGES.length);
  });

  it('translates the agent greeting', () => {
    expect(STRINGS.en.greeting).toContain('Domestic AI Agent');
    for (const code of ['am', 'om', 'so', 'ti', 'sw'] as const) {
      expect(STRINGS[code].greeting).toContain('AI');
    }
  });
});
