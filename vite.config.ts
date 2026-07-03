import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/mathlive/") || id.includes("/node_modules/@cortex-js/compute-engine/")) {
            return "mathlive";
          }
        }
      }
    }
  }
});
