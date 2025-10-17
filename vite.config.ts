import { defineConfig } from 'vite';
import banner from 'vite-plugin-banner';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';


const version = require('./package.json').version;
const bannerContent = `/*!
* vite-plugin-override-deps v${version}
* (c) Hichem Taboukouyout
* Released under the MIT License.
* Github: github.com/HichemTab-tech/vite-plugin-override-deps
*/
   `;

export default defineConfig({
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.ts'), // Library entry point
            name: 'OverrideDepsAtRuntime',
            fileName: (format: string) => `main${format === 'es' ? '.esm' : '.min'}.js`,
            formats: ['es', 'umd']
        },
        rollupOptions: {
            external: ['vite', 'path', 'fs', 'module'],
            output: {
                globals: {
                    vite: 'vite',
                    path: 'path',
                    fs: 'fs',
                    module: 'module'
                }
            }
        }
    },
    plugins: [
        banner(bannerContent),
        dts({
            entryRoot: 'src', // Base folder for type generation
            outDir: 'dist', // Ensures types go into `dist/`
            insertTypesEntry: true, // Adds the `types` field in package.json
            exclude: ['node_modules', 'dist'], // Exclude unnecessary files
        })
    ]
});
