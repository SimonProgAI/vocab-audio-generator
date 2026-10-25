// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_KEY_STORAGE_KEY, BUILT_IN_API_KEY, currentApiKey, forgetApiKey, loadApiKey, saveApiKey } from "./apiKey";

afterEach(() => {
  vi.restoreAllMocks();
  forgetApiKey();
  localStorage.clear();
  sessionStorage.clear();
});

describe("API key storage", () => {
  it("falls back to the built-in key when none was entered", () => {
    expect(BUILT_IN_API_KEY).toBe("test-key");
    expect(loadApiKey()).toBeUndefined();
    expect(currentApiKey()).toBe("test-key");
  });

  it("keeps a key for this tab only by default", () => {
    saveApiKey("sk-visitor-1234", false);
    expect(loadApiKey()).toEqual({ key: "sk-visitor-1234", remembered: false });
    expect(currentApiKey()).toBe("sk-visitor-1234");
    expect(sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBe("sk-visitor-1234");
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
  });

  it("keeps a remembered key on the device", () => {
    saveApiKey("sk-visitor-1234", true);
    expect(loadApiKey()).toEqual({ key: "sk-visitor-1234", remembered: true });
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBe("sk-visitor-1234");
    expect(sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
  });

  it("removes the key from the device when Remember is turned off", () => {
    saveApiKey("sk-visitor-1234", true);
    saveApiKey("sk-visitor-1234", false);
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
    expect(loadApiKey()).toEqual({ key: "sk-visitor-1234", remembered: false });
  });

  it("trims the key, and saving an empty one just forgets the old one", () => {
    saveApiKey("  sk-visitor-1234 \n", false);
    expect(currentApiKey()).toBe("sk-visitor-1234");
    saveApiKey("   ", false);
    expect(loadApiKey()).toBeUndefined();
  });

  it("forgets the key everywhere, going back to the built-in one", () => {
    saveApiKey("sk-visitor-1234", true);
    forgetApiKey();
    expect(loadApiKey()).toBeUndefined();
    expect(localStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull();
    expect(currentApiKey()).toBe("test-key");
  });

  it("still works for this page when the browser blocks storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    saveApiKey("sk-visitor-1234", true);
    expect(loadApiKey()).toEqual({ key: "sk-visitor-1234", remembered: true });
    forgetApiKey();
    expect(loadApiKey()).toBeUndefined();
  });
});
