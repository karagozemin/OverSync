// @vitest-environment node
import { resolveConfig } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllEnvs());

describe('coordinator URL in Vite configuration', () => {
  it.each(['http://localhost:3001', 'http://coordinator.example', '//coordinator.example', 'https:coordinator.example', 'invalid'])(
    'rejects %s when building, including in a custom mode',
    async (url) => {
      vi.stubEnv('VITE_API_BASE_URL', url);
      await expect(resolveConfig({}, 'build', 'staging')).rejects.toThrow(
        'VITE_API_BASE_URL must be an absolute HTTPS URL for frontend builds.',
      );
    },
  );

  it.each(['https://coordinator.example', ''])('accepts %j when building', async (url) => {
    vi.stubEnv('VITE_API_BASE_URL', url);
    await expect(resolveConfig({}, 'build', 'production')).resolves.toMatchObject({ command: 'build' });
  });

  it('allows localhost HTTP in the dev server', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3001');
    await expect(resolveConfig({}, 'serve', 'development')).resolves.toMatchObject({ command: 'serve' });
  });
});
