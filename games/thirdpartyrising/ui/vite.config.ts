import { defineConfig } from "vite";

// All game data (state packs, content, rules) lives in ../data and is served as static files.
export default defineConfig({
  base: "./",
  publicDir: "../data",
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
  server: { port: 5178, strictPort: true },
  clearScreen: false,
});
