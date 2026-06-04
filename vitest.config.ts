/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vitest needs to know about the tsconfig "paths" aliases that
// Next.js resolves at build time. Mirror them here so test files can
// import from "@/lib/...", "@/components/...", etc. We also pull in
// the React plugin so JSX in .tsx files compiles in tests (Next's
// `jsx: "preserve"` would otherwise leave JSX as-is in vitest).
//
// The whole config is cast to `any` to dodge a benign type mismatch
// between two installed vite versions (project vite vs vitest's
// nested vite). The runtime is fine; only the dts is incompatible.
const config = {
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@/lib': path.resolve(__dirname, 'lib'),
      '@/types': path.resolve(__dirname, 'types'),
      '@/components': path.resolve(__dirname, 'components'),
    },
  },
  test: {
    environment: 'jsdom' as const,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    globals: true,
  },
};

export default defineConfig(config as any);
