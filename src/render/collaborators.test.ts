import { describe, expect, it } from 'vitest';
import { cleanNames, MAX_COLLABORATORS } from './collaborators';

describe('cleanNames', () => {
  it('keeps human logins, drops bots, repeats, blanks and non-strings', () => {
    expect(cleanNames(['alice', 'dependabot[bot]', 'bob', 'alice', '', 7, null, 'Pre-Commit-CI[BOT]', 'carol'])).toEqual(['alice', 'bob', 'carol']);
  });
  it('caps the list and copes with junk', () => {
    expect(cleanNames(Array.from({ length: 50 }, (_, i) => 'u' + i))).toHaveLength(MAX_COLLABORATORS);
    expect(cleanNames(undefined)).toEqual([]);
    expect(cleanNames({})).toEqual([]);
  });
});
