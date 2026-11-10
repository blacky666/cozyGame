import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';

describe('CONFIG', () => {
  it('awards 5/3/1/0 points by placement', () => {
    expect(CONFIG.points).toEqual([5, 3, 1, 0]);
  });

  it('defaults to 6 rounds', () => {
    expect(CONFIG.rounds.default).toBe(6);
  });

  it('scales the 426px view by 3 to ~1280px', () => {
    expect(CONFIG.view.width * CONFIG.view.zoom).toBe(1278);
  });

  it('simulates at 30 Hz', () => {
    expect(CONFIG.net.simHz).toBe(30);
  });
});
