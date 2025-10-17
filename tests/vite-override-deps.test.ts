import { describe, it, expect } from 'vitest';
import { overrideDeps, type PluginOptions, type TargetConfig } from '../src';
import type { Plugin } from 'vite';
import type { TransformPluginContext, PluginContext, TransformResult } from 'rollup';

describe('vite-override-deps', () => {
    const getTransform = (options: PluginOptions) => {
        const plugin = overrideDeps(options) as Plugin;
        const transformHook = plugin.transform;
        const transformFn = typeof transformHook === 'function' ? transformHook : transformHook?.handler;
        if (!transformFn) throw new Error('transform function not found');
        return async (code: string, id = 'src/main.js') => await transformFn.call({} as TransformPluginContext, code, id);
    };

    const getResolveId = (options: PluginOptions) => {
        const plugin = overrideDeps(options) as Plugin;
        const resolveHook = plugin.resolveId;
        const resolveFn = typeof resolveHook === 'function' ? resolveHook : resolveHook?.handler;
        if (!resolveFn) throw new Error('resolveId function not found');
        return async (source: string) => await resolveFn.call({} as PluginContext, source, undefined, { isEntry: false, attributes: {} });
    };

    const getLoad = (options: PluginOptions) => {
        const plugin = overrideDeps(options) as Plugin;
        const loadHook = plugin.load;
        const loadFn = typeof loadHook === 'function' ? loadHook : loadHook?.handler;
        if (!loadFn) throw new Error('load function not found');
        return async (id: string) => await loadFn.call({} as PluginContext, id);
    };

    const getCode = (result: TransformResult) => {
        if (typeof result === 'string') return result;
        return result?.code;
    }

    describe('transform', () => {
        const targets: TargetConfig[] = [{ package: 'react', overrides: {} }];

        it('should rewrite default imports', async () => {
            const transform = getTransform({ targets });
            const code = "import React from 'react';";
            const result = await transform(code);
            expect(getCode(result)).toBe("import React from 'virtual:react';");
        });

        it('should rewrite named imports', async () => {
            const transform = getTransform({ targets });
            const code = 'import { useState, useMemo } from "react";';
            const result = await transform(code);
            expect(getCode(result)).toBe('import { useState, useMemo } from "virtual:react";');
        });

        it('should rewrite namespace imports', async () => {
            const transform = getTransform({ targets });
            const code = "import * as React from 'react';";
            const result = await transform(code);
            expect(getCode(result)).toBe("import * as React from 'virtual:react';");
        });

        it('should rewrite side-effect imports by default', async () => {
            const transform = getTransform({ targets });
            const code = "import 'react';";
            const result = await transform(code);
            expect(getCode(result)).toBe("import 'virtual:react';");
        });

        it('should not rewrite side-effect imports if disabled', async () => {
            const transform = getTransform({
                targets: [{ package: 'react', rewriteSideEffectImports: false, overrides: {} }],
            });
            const code = "import 'react';";
            const result = await transform(code);
            expect(getCode(result)).toBe(undefined);
        });

        it('should rewrite exports', async () => {
            const transform = getTransform({ targets });
            const code = "export * from 'react';\nexport { useState } from 'react';";
            const result = await transform(code);
            expect(getCode(result)).toBe("export * from 'virtual:react';\nexport { useState } from 'virtual:react';");
        });

        it('should not transform code without the target package', async () => {
            const transform = getTransform({ targets });
            const code = "import Vue from 'vue';";
            const result = await transform(code);
            expect(result).toBeNull();
        });

        it('should handle multiple targets', async () => {
            const transform = getTransform({
                targets: [{ package: 'react', overrides: {} }, { package: 'vue', overrides: {} }],
            });
            const code = "import React from 'react';\nimport Vue from 'vue';";
            const result = await transform(code);
            expect(getCode(result)).toBe("import React from 'virtual:react';\nimport Vue from 'virtual:vue';");
        });

        it('should use custom alias', async () => {
            const transform = getTransform({
                targets: [{ package: 'react', alias: 'my-react', overrides: {} }],
            });
            const code = "import React from 'react';";
            const result = await transform(code);
            expect(getCode(result)).toBe("import React from 'my-react';");
        });
    });

    describe('resolveId', () => {
        it('should resolve virtual modules', async () => {
            const resolveId = getResolveId({
                targets: [{ package: 'react', alias: 'my-react', overrides: {} }],
            });
            const result = await resolveId('my-react');
            expect(result).toBe('\0virtual:my-react');
        });

        it('should return null for other ids', async () => {
            const resolveId = getResolveId({
                targets: [{ package: 'react', alias: 'my-react', overrides: {} }],
            });
            const result = await resolveId('react');
            expect(result).toBeNull();
        });
    });

    describe('load', () => {
        it('should load virtual module with overrides', async () => {
            const load = getLoad({
                targets: [
                    {
                        package: 'react',
                        overrides: {
                            useMemo: '(original) => original.useMemo',
                            useState: '() => { console.log("useState hooked"); return original.useState(); }',
                        },
                    },
                ],
            });
            const result = await load('\0virtual:virtual:react');
            expect(result).toContain('import * as original from "react";');
            expect(result).toContain('export default original.default ?? original;');
            expect(result).toContain('export const useMemo = (original) => original.useMemo;');
            expect(result).toContain('export const useState = () => { console.log("useState hooked"); return original.useState(); };');
            expect(result).toContain('export const __namespace = original;');
        });

        it('should return null for non-virtual modules', async () => {
            const load = getLoad({ targets: [{ package: 'react', overrides: {} }] });
            const result = await load('react');
            expect(result).toBeNull();
        });
    });
});
