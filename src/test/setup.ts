import axios from "axios";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server";

// Under Node, axios's default http adapter returns `responseType: "blob"` as a string.
// The fetch adapter returns a real Blob, like the browser's XHR adapter does.
// This must run before ttsApi.ts creates its axios instances.
axios.defaults.adapter = "fetch";

// "error" fails any request without a handler instead of letting it reach the network.
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
