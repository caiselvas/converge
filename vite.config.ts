import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { observationsRoute } from "./backend/observations";

export default defineConfig({
  root: "frontend",
  plugins: [
    react(),
    {
      name: "official-data",
      configureServer(server) {
        server.middlewares.use("/api/observations", observationsRoute);
      },
    },
  ],
  server: { port: 5173, fs: { allow: [".."] } },
  build: { outDir: "../dist", emptyOutDir: true },
});
