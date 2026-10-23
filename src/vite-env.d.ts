/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TTS_API_KEY?: string;
  readonly VITE_TTS_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
