import { describe, test, expect } from 'vitest';
import { buildEvidenceData, type EvidenceData } from './evidence';

describe('buildEvidenceData', () => {
  const data: EvidenceData = buildEvidenceData();

  test('returns canonical repo URL', () => {
    expect(data.repoUrl).toBe('https://github.com/karagozemin/OverSync');
  });

  test('contains no private RPC URLs or localhost values', () => {
    const serialized = JSON.stringify(data);

    const secrets = [
      'infura.io',
      'alchemy',
      '127.0.0.1',
      'localhost',
      '0x0000000000000000000000000000000000000000',
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ];

    for (const pattern of secrets) {
      expect(serialized).not.toContain(pattern);
    }
  });
});
