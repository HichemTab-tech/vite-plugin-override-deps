# Override deps at runtime

> 🧩 Intercept and override dependencies at build-time with Vite.

A lightweight Vite plugin that lets you **replace, extend,
or patch libraries** (like React, Zustand, etc.) using custom virtual modules —
without forking or touching `node_modules`.

## Getting Started

```sh
npm install vite-plugin-override-deps -D
```

or, if using pnpm:

```sh
pnpm add vite-plugin-override-deps -D
```


## Usage

Add the plugin to your `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import overrideDeps from "vite-plugin-override-deps";

export default defineConfig({
  plugins: [
    react(),
    overrideDeps({
      targets: [
        {
          package: "react",
          overrides: {
            useMemo: (o) => `(...args) => {
              console.log("Custom useMemo!");
              return ${o}.useMemo(...args);
            }`
          }
        }
      ]
    })
  ]
});
```

Now every import from `"react"` will be rewritten to a virtual version that exports all React APIs but uses your custom `useMemo`.

## Why

* Patch libraries without forking
* Log or instrument internal behavior


## Issues

If you encounter any issue, please open an issue [here](https://github.com/HichemTab-tech/vite-plugin-override-deps/issues).

## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) file for more details.

&copy; 2025 [Hichem Taboukouyout](mailto:hichem.taboukouyout@hichemtab-tech.me)

---

_If you found this package helpful, consider leaving a star! ⭐️_
