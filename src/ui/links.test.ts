import { expect, it } from 'vitest';
import { fileUrl } from './links';

it('builds the github blob url, with the subfolder prefix and encoding', () => {
  expect(fileUrl({ owner: 'pallets', repo: 'flask', ref: 'main' }, 'src/flask/app.py')).toBe('https://github.com/pallets/flask/blob/main/src/flask/app.py');
  expect(fileUrl({ owner: 'a', repo: 'b', ref: 'HEAD', subPath: 'packages/x' }, 'src/my file.ts')).toBe('https://github.com/a/b/blob/HEAD/packages/x/src/my%20file.ts');
  expect(fileUrl({ owner: 'a', repo: 'b', ref: 'feature/x' }, 'README.md')).toBe('https://github.com/a/b/blob/feature/x/README.md');
});
