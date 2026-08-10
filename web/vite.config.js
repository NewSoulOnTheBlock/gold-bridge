import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by the bridge under /link, so assets must be prefixed with /link/.
export default defineConfig({
  plugins: [react()],
  base: "/link/",
  build: { outDir: "dist", emptyOutDir: true },
});
