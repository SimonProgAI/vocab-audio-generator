/// <reference types="vitest/config" />
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
  // Relative asset paths, so the build also works from a subfolder such as GitHub Pages'
  // /vocab-audio-generator/.
  base: "./",
  plugins: [react(), tailwindcss()],
  server: { proxy: ttsProxy },
  preview: { proxy: ttsProxy },
  test: {
    // Overrides .env so tests never send the real key. tts.test is a reserved domain that
    // never resolves, and MSW (src/test/setup.ts) answers or blocks every request anyway.
    env: { VITE_TTS_API_KEY: "test-key", VITE_TTS_API_ORIGIN: "https://tts.test" },
    setupFiles: ["src/test/setup.ts"],
  },
});
