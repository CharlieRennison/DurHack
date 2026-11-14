import { expect, it } from 'vitest';
import { untilMidnight } from './panels';

it('counts down to the next local midnight', () => {
  expect(untilMidnight(new Date(2026, 10, 14, 21, 30, 15))).toBe('02:29:45');
  expect(untilMidnight(new Date(2026, 10, 14, 23, 59, 59))).toBe('00:00:01');
  expect(untilMidnight(new Date(2026, 10, 14, 0, 0, 0))).toBe('24:00:00');
});
