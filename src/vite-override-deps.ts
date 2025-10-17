import path from "path";
import fs from "fs";
import type { Plugin } from 'vite';

export type OverrideBody = string | ((originalNamespace: string) => string);

export type TargetConfig = {
    /**
     * Original package name to override. e.g. "react"
     */
    package: string;
    /**
     * Virtual alias the source code will import after rewrite. Defaults to `virtual:<package>`.
     */
    alias?: string;
    /**
     * Map of exportName -> body.
     * The body can be a string (JS expression or function body) or a function
     * that receives the original import namespace identifier (usually "original") and
     * returns a string for the right-hand side.
     *
     * Example:
     * overrides: {
     *   useMemo: (o) => `(...args) => { console.log("mine!"); return ${o}.useMemo(...args); }`,
     *   createElement: `${o}.createElement`,
     * }
     */
    overrides: Record<string, OverrideBody>;

    /**
     * @deprecated well actually it's the opposite of deprecated, it's not ready yet :D
     * Instead of putting overrides in plain text, you can also provide a full file path
     */
    fileOverride?: string;
    /**
     * Optional: ALSO rewrite "import 'react'" side-effect-only imports.
     * Defaults true.
     */
    rewriteSideEffectImports?: boolean;
};

export type PluginOptions = {
    targets: TargetConfig[];
    /**
     * Filter to limit which files are transformed for import rewriting.
     * Defaults to only transform user code (excludes node_modules, virtuals).
     */
    include?: (id: string) => boolean;
};

const VIRTUAL_PREFIX = '\0virtual:';

export function overrideDeps(options: PluginOptions): Plugin {
    const targets = options.targets.map(t => ({
        ...t,
        alias: t.alias ?? `virtual:${t.package}`,
        rewriteSideEffectImports: t.rewriteSideEffectImports ?? true,
    }));

    const aliasToTarget = new Map<string, TargetConfig>();
    const pkgToTarget = new Map<string, TargetConfig>();
    for (const t of targets) {
        aliasToTarget.set(t.alias!, t);
        pkgToTarget.set(t.package, t);
    }

    const include = options.include ?? ((id) => {
        // user-land only
        return !id.includes('/node_modules/') && !id.startsWith(VIRTUAL_PREFIX) && !id.startsWith('\0');
    });

    return {
        name: 'vite-override-deps',
        enforce: 'pre',

        resolveId(source) {
            // If someone manually imports the alias, resolve it as virtual.
            if (aliasToTarget.has(source)) {
                return VIRTUAL_PREFIX + source;
            }
            return null;
        },

        async load(id) {
            if (!id.startsWith(VIRTUAL_PREFIX)) return null;
            const alias = id.slice(VIRTUAL_PREFIX.length);
            const t = aliasToTarget.get(alias);
            if (!t) return null;

            // If a file path is provided, just load it
            if (t.fileOverride) {
                const abs = path.resolve(process.cwd(), t.fileOverride);
                return fs.readFileSync(abs, "utf8");
            }

            const ns = "original";
            const pkg = t.package;

            // Try to enumerate CJS named exports (React is CJS)
            let keys: string[] = [];

            // First try to use createRequire (Node ESM). We import 'module' dynamically so bundlers won't statically
            // analyze and fail to export createRequire for browser builds.
            try {
                const modModule = await import('module');
                const createRequire = (modModule as any).createRequire;
                if (createRequire) {
                    const req = createRequire(import.meta.url);
                    const mod = req(pkg);               // CJS object w/ properties
                    if (mod && typeof mod === "object") {
                        keys = Object.keys(mod).filter(k => k !== "default");
                    }
                }
            } catch (e) {
                // If that fails (e.g. not running in Node), try a dynamic ESM import as a fallback.
                try {
                    const esm = await import(pkg).catch(() => null);
                    if (esm && typeof esm === 'object') {
                        keys = Object.keys(esm).filter(k => k !== 'default');
                    }
                } catch {
                    // swallow
                }
            }

            const out: string[] = [];
            out.push(`import * as ${ns} from "${pkg}";`);
            // Default: prefer default if present; otherwise expose namespace
            out.push(`export default ${ns}.default ?? ${ns};`);

            // Pass-through named exports explicitly (no `export *` so no interop warning)
            const keysToSkip = Object.keys(t.overrides??{});
            keys = keys.filter(k => !keysToSkip.includes(k));
            for (const k of keys) {
                const ident = safeIdent(k);
                out.push(`export const ${ident} = ${ns}[${JSON.stringify(k)}];`);
            }

            // Your overrides (shadow the passthroughs)
            for (const [name, body] of Object.entries(t.overrides ?? {})) {
                const rhs = typeof body === "function" ? body(ns) : body;
                out.push(`export const ${safeIdent(name)} = ${rhs};`);
            }

            // optional: expose the whole namespace
            out.push(`export const __namespace = ${ns};`);

            return out.join("\n");
        },

        transform(code, id) {
            if (!include(id)) return null;

            // Fast path: only bother if the file mentions one of the packages
            const maybe = [...pkgToTarget.keys()].some(pkg => code.includes(`'${pkg}'`) || code.includes(`"${pkg}"`));
            if (!maybe) return null;

            // Naive but robust-enough rewrites for common cases:
            // import React from 'react'
            // import { useMemo } from "react"
            // import * as R from 'react'
            // import 'react'
            let transformed = code;

            for (const t of targets) {
                const pkg = t.package;
                const alias = t.alias!;
                const sideEffects = t.rewriteSideEffectImports;

                // 1) rewrite specifier imports
                transformed = transformed
                    // import ... from 'react'
                    .replace(
                        new RegExp(String.raw`(\bimport\s+[^'"]*?\sfrom\s*)(['"])${escapeForRegex(pkg)}\2`, 'g'),
                        `$1$2${alias}$2`
                    )
                    // import 'react'
                    .replace(
                        new RegExp(String.raw`(\bimport\s*)(['"])${escapeForRegex(pkg)}\2`, 'g'),
                        (m, impKw: string, q: string) => {
                            return sideEffects ? `${impKw}${q}${alias}${q}` : m;
                        }
                    )
                    // export * from 'react' (rare, but keep consistent)
                    .replace(
                        new RegExp(String.raw`(\bexport\s+\*\s+from\s*)(['"])${escapeForRegex(pkg)}\2`, 'g'),
                        `$1$2${alias}$2`
                    )
                    // export { x } from 'react'
                    .replace(
                        new RegExp(String.raw`(\bexport\s+\{[^}]*\}\s+from\s*)(['"])${escapeForRegex(pkg)}\2`, 'g'),
                        `$1$2${alias}$2`
                    );
            }

            if (transformed === code) return null;
            return { code: transformed, map: null };
        },
    };
}

function escapeForRegex(s: string) {
    // minimal escape
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeIdent(name: string) {
    // very simple safeguard; for exotic names you could mangle or re-export with `export { ident as "weird-name" }`
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : `__${name.replace(/\W/g, "_")}`;
}
