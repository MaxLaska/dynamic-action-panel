import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * Vitest configuration.
 *
 * - `@` mirrors the tsconfig path alias to `src/`.
 * - `obsidian` resolves to a minimal test mock: the real package is an
 *   API-only type stub without a runtime implementation, so any module that
 *   imports it needs the mock when running under Node.
 * - Tests live under `tests/` and target services and pure logic; no DOM or
 *   browser environment is needed at this stage.
 */
export default defineConfig({
    resolve: {
        alias: {
            '@': `${rootDir}src`,
            obsidian: `${rootDir}tests/mocks/obsidian.ts`,
        },
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
