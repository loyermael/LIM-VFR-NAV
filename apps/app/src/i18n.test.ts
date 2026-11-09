import { describe, expect, it } from "vitest";
import { KEYS, t } from "./i18n";

describe("i18n", () => {
  it("chaque clé existe en fr et en, sans texte vide", () => {
    for (const k of KEYS) {
      expect(t("fr", k).length).toBeGreaterThan(0);
      expect(t("en", k).length).toBeGreaterThan(0);
    }
  });
});
