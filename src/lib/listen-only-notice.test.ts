import { describe, it, expect } from "vitest";
import {
  noticeForEngagement,
  noticeAfterTransition,
  consentWasStated,
  type NoticeInputs,
} from "./listen-only-notice";

const ENGAGING: NoticeInputs = {
  engaged: true,
  systemAudio: true,
  consentSeen: false,
  outputIsSpeakers: false,
};

describe("noticeForEngagement", () => {
  // The statement the whole mode rests on.
  it("states consent the first time the mode actually captures", () => {
    expect(noticeForEngagement(ENGAGING)).toBe("consent");
  });

  it("does not repeat consent once it has been seen", () => {
    expect(noticeForEngagement({ ...ENGAGING, consentSeen: true })).toBeNull();
  });

  // Under the escape hatch nothing is captured, so a statement about what Iris
  // hears would be false.
  it("says nothing when the engagement captures no system audio", () => {
    expect(noticeForEngagement({ ...ENGAGING, systemAudio: false })).toBeNull();
    expect(noticeForEngagement({ ...ENGAGING, systemAudio: false, consentSeen: true, outputIsSpeakers: true })).toBeNull();
  });

  it("says nothing on a disengaging edge", () => {
    expect(noticeForEngagement({ ...ENGAGING, engaged: false })).toBeNull();
  });

  it("advises headphones only once consent is settled and output is speakers", () => {
    expect(noticeForEngagement({ ...ENGAGING, consentSeen: true, outputIsSpeakers: true })).toBe("headphones");
    expect(noticeForEngagement({ ...ENGAGING, consentSeen: true, outputIsSpeakers: false })).toBeNull();
  });

  // Consent is about permission, the headphone tip is about audio quality.
  // Competing for the same slot on a first engage would bury the former.
  it("prefers consent over the headphone advice when both would apply", () => {
    expect(noticeForEngagement({ ...ENGAGING, outputIsSpeakers: true })).toBe("consent");
  });
});

describe("noticeAfterTransition", () => {
  // A statement about what Iris is hearing must not outlive the hearing.
  it("clears any notice on disengage", () => {
    expect(noticeAfterTransition("consent", { ...ENGAGING, engaged: false })).toBeNull();
    expect(noticeAfterTransition("refused", { ...ENGAGING, engaged: false })).toBeNull();
  });

  // A "refused" notice raised by main must survive an engaging push that has
  // nothing of its own to say.
  it("leaves an existing notice alone when the engagement raises none", () => {
    const settled = { ...ENGAGING, consentSeen: true, outputIsSpeakers: false };
    expect(noticeAfterTransition("refused", settled)).toBe("refused");
  });

  it("replaces an existing notice when the engagement has something to say", () => {
    expect(noticeAfterTransition("refused", ENGAGING)).toBe("consent");
  });
});

describe("consentWasStated", () => {
  it("is true only for the consent notice", () => {
    expect(consentWasStated("consent")).toBe(true);
    for (const other of ["headphones", "refused", null] as const) {
      expect(consentWasStated(other)).toBe(false);
    }
  });
});
