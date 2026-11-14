import { describe, expect, it } from 'vitest';
import { STRINGS } from './i18n';

describe('i18n', () => {
  it('defines every key in both English and Amharic', () => {
    const en = Object.keys(STRINGS.en).sort();
    const am = Object.keys(STRINGS.am).sort();
    expect(am).toEqual(en);
  });

  it('keeps non-empty strings everywhere', () => {
    for (const strings of [STRINGS.en, STRINGS.am]) {
      for (const [key, value] of Object.entries(strings)) {
        expect(value.trim(), `key ${key}`).not.toBe('');
      }
    }
  });

  it('translates the agent greeting', () => {
    expect(STRINGS.en.greeting).toContain('Domestic AI Agent');
    expect(STRINGS.am.greeting).toContain('AI');
  });
});
