import { describe, expect, it } from "vitest";
import { createTranslator } from "./index.js";

describe("createTranslator", () => {
  it("uses Chinese for zh locales and falls back to English keys", () => {
    const zh = createTranslator("zh-cn");
    const unknown = zh("unknown.key");

    expect(zh("dashboard.title")).toBe("学习批注");
    expect(unknown).toBe("unknown.key");
  });

  it("uses English for all other locales", () => {
    expect(createTranslator("fr")("dashboard.title")).toBe("Learning annotations");
  });
});

