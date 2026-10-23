/** Resolves after `ms`, or as soon as `signal` aborts. Never rejects. */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = window.setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}
