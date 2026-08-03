import { describe, expect, it } from "vitest";
import { mailtoLink, slotEnquiry, whatsappLink } from "@/lib/contact-links";

describe("whatsappLink", () => {
  it("strips everything that is not a digit from the number", () => {
    // wa.me rejects "+355 69 219 2666": the plus and spaces make a dead link.
    expect(whatsappLink("+355 69 219 2666", "hi")).toBe(
      "https://wa.me/355692192666?text=hi",
    );
  });

  it("percent-encodes the message", () => {
    expect(whatsappLink("+355691112222", "Booth 1, 09:00 - 10:00")).toBe(
      "https://wa.me/355691112222?text=Booth%201%2C%2009%3A00%20-%2010%3A00",
    );
  });

  it("returns nothing when the number holds no digits at all", () => {
    expect(whatsappLink("", "hi")).toBe("");
    expect(whatsappLink("n/a", "hi")).toBe("");
  });
});

describe("mailtoLink", () => {
  it("puts the slot in the subject and the message in the body", () => {
    expect(mailtoLink("info@example.com", "Booth 1", "Hi there")).toBe(
      "mailto:info@example.com?subject=Booth%201&body=Hi%20there",
    );
  });

  it("encodes characters that would otherwise break the query", () => {
    expect(mailtoLink("a@b.com", "9 & 10", "x=1")).toBe(
      "mailto:a@b.com?subject=9%20%26%2010&body=x%3D1",
    );
  });

  it("returns nothing without an address", () => {
    expect(mailtoLink("", "s", "b")).toBe("");
  });
});

describe("slotEnquiry", () => {
  it("names the booth, the day and the exact slot", () => {
    expect(slotEnquiry("Booth 2", "Tue, 5 Aug", "09:00", "10:30")).toBe(
      "Hi, I'd like to ask about the Booth 2 booking on Tue, 5 Aug, 09:00 - 10:30.",
    );
  });
});
