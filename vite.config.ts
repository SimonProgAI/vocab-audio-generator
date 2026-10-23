import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Same-origin proxy to TTS.ai so browser requests (including audio downloads)
// are not blocked by CORS. The app calls /tts-api/... by default.
const ttsProxy: Record<string, ProxyOptions> = {
  "/tts-api": {
    target: "https://api.tts.ai",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/tts-api/, ""),
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: ttsProxy },
  preview: { proxy: ttsProxy },
});
