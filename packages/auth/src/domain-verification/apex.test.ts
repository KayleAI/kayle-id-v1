import { describe, expect, test } from "bun:test";
import {
  ApexExtractionError,
  extractApexDomain,
  hostnameToApex,
  isHostUnderApex,
  normalizeHostname,
} from "./apex";

describe("normalizeHostname", () => {
  test("lowercases and strips trailing dot", () => {
    expect(normalizeHostname("Acme.CO.")).toBe("acme.co");
  });

  test("rejects empty string", () => {
    expect(() => normalizeHostname("")).toThrow(ApexExtractionError);
  });

  test("rejects single-label hosts", () => {
    expect(() => normalizeHostname("localhost")).toThrow(ApexExtractionError);
  });

  test("rejects hosts containing characters outside ascii dns set", () => {
    expect(() => normalizeHostname("acmé.co")).toThrow(ApexExtractionError);
  });

  test("rejects xn-- punycode labels", () => {
    expect(() => normalizeHostname("xn--acme-7za.co")).toThrow(
      ApexExtractionError
    );
  });

  test("rejects underscored labels", () => {
    expect(() => normalizeHostname("_acme.co")).toThrow(ApexExtractionError);
  });
});

describe("extractApexDomain", () => {
  test("two-label hosts return as-is", () => {
    expect(extractApexDomain("acme.co")).toBe("acme.co");
  });

  test("subdomains collapse to apex", () => {
    expect(extractApexDomain("app.acme.co")).toBe("acme.co");
    expect(extractApexDomain("id.app.acme.co")).toBe("acme.co");
  });

  test("recognises common multi-label suffixes", () => {
    expect(extractApexDomain("acme.co.uk")).toBe("acme.co.uk");
    expect(extractApexDomain("id.acme.co.uk")).toBe("acme.co.uk");
    expect(extractApexDomain("app.id.acme.co.uk")).toBe("acme.co.uk");
    expect(extractApexDomain("acme.com.au")).toBe("acme.com.au");
    expect(extractApexDomain("ops.acme.gov.uk")).toBe("acme.gov.uk");
  });

  test("rejects bare public suffixes", () => {
    expect(() => extractApexDomain("co.uk")).toThrow(ApexExtractionError);
  });
});

describe("hostnameToApex", () => {
  test("end-to-end lowercase + apex", () => {
    expect(hostnameToApex("APP.Acme.Co.UK")).toBe("acme.co.uk");
  });
});

describe("isHostUnderApex", () => {
  test("matches apex itself", () => {
    expect(isHostUnderApex("acme.co", "acme.co")).toBeTrue();
  });

  test("matches subdomain", () => {
    expect(isHostUnderApex("app.acme.co", "acme.co")).toBeTrue();
    expect(isHostUnderApex("a.b.c.acme.co", "acme.co")).toBeTrue();
  });

  test("rejects look-alike hosts", () => {
    expect(isHostUnderApex("acme-evil.co", "acme.co")).toBeFalse();
    expect(isHostUnderApex("evilacme.co", "acme.co")).toBeFalse();
  });

  test("rejects different apex", () => {
    expect(isHostUnderApex("app.other.co", "acme.co")).toBeFalse();
  });
});
