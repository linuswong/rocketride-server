import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
 plugins: [pluginReact()],
 source: { entry: { index: './test/browser/fixture.tsx' } },
 output: { distPath: { root: './test/browser/dist' } },
});
