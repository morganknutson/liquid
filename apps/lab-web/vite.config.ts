import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@liquid/addy-logo": fileURLToPath(new URL("../../packages/addy-logo/src/index.ts", import.meta.url)),
      "@liquid/core": fileURLToPath(new URL("../../packages/liquid-core/src/index.ts", import.meta.url)),
      "@liquid/web": fileURLToPath(new URL("../../packages/liquid-web/src/index.ts", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        lab: fileURLToPath(new URL("./index.html", import.meta.url)),
        "addy-logo": fileURLToPath(new URL("./addy-logo.html", import.meta.url)),
      },
    },
  },
});
