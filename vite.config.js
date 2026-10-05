import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Firebase lives in its own chunk, loaded after the editor is already
    // on screen, so its size doesn't slow down opening the app.
    chunkSizeWarningLimit: 600,
  },
});
