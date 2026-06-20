import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "server/index.ts",
    target: "node22",
    outDir: "server-dist",
    emptyOutDir: true,
    minify: false,
    rollupOptions: { output: { entryFileNames: "index.js" } }
  }
});
