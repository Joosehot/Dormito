import { defineConfig } from "vite";

// Relative base so the built folder works from any path (file server, a subfolder of a site).
export default defineConfig({
  base: "./",
  server: { port: 5810, host: "127.0.0.1" },
});
