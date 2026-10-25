import { setupServer } from "msw/node";

/** Mock TTS.ai. Tests register handlers with server.use(); they are reset after each test. */
export const server = setupServer();
