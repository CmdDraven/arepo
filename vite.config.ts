import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tanstackStart(), react(), tailwindcss(), tsconfigPaths()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8734",
        changeOrigin: false,
      },
    },
  },
});
