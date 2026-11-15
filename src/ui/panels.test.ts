import { expect, it } from 'vitest';
import { untilTime } from './panels';

it('counts down to the next 9:30', () => {
  expect(untilTime(new Date(2026, 10, 14, 8, 0, 0), 9, 30)).toBe('01:30:00');
  expect(untilTime(new Date(2026, 10, 14, 9, 29, 59), 9, 30)).toBe('00:00:01');
  expect(untilTime(new Date(2026, 10, 14, 9, 30, 0), 9, 30)).toBe('00:00:00');
  expect(untilTime(new Date(2026, 10, 14, 21, 30, 15), 9, 30)).toBe('11:59:45');
});
