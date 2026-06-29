export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // Resolve the SDK logging sub-path export directly from TypeScript
    // source so tests run without a prior `pnpm --filter @oversync/sdk build`.
    '^@oversync/sdk/logging$': '<rootDir>/../packages/sdk/src/logging/index.ts',
    // Strip .js extensions so ts-jest can find the TypeScript source.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
};
