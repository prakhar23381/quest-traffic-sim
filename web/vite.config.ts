import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the API server runs separately (npm run dev -w server, port 8080;
// set API_URL to point elsewhere).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": process.env.API_URL ?? "http://localhost:8080" } },
  worker: { format: "es" },
  build: { chunkSizeWarningLimit: 1500 },
});
