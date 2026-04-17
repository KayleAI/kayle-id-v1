import { describe, expect, test } from "bun:test";
import {
  objectType,
  parseDistinguishedNameAttributes,
  sourceCountryCode,
} from "./import-icao-pkd";

describe("ICAO PKD LDIF DN parsing", () => {
  test("extracts top-level object metadata without matching escaped subject attributes", () => {
    const distinguishedName =
      "cn=CN=United Nations CSCA\\,OU=Certification Authorities\\,O=United Nations\\,C=ZZ+sn=50174657,o=dsc,c=ZZ,dc=data,dc=download,dc=pkd,dc=icao,dc=int";

    expect(parseDistinguishedNameAttributes(distinguishedName)).toEqual([
      {
        name: "cn",
        value:
          "CN=United Nations CSCA,OU=Certification Authorities,O=United Nations,C=ZZ+sn=50174657",
      },
      {
        name: "o",
        value: "dsc",
      },
      {
        name: "c",
        value: "ZZ",
      },
      {
        name: "dc",
        value: "data",
      },
      {
        name: "dc",
        value: "download",
      },
      {
        name: "dc",
        value: "pkd",
      },
      {
        name: "dc",
        value: "icao",
      },
      {
        name: "dc",
        value: "int",
      },
    ]);
    expect(objectType(distinguishedName)).toBe("dsc");
    expect(sourceCountryCode(distinguishedName)).toBe("ZZ");
  });

  test("keeps the outer PKD object type when the embedded subject contains escaped organization and country attributes", () => {
    const distinguishedName =
      "cn=cn=Passport Country Signing Authority\\,ou=APO\\,ou=DFAT\\,o=GOV\\,c=AU,o=cr";

    expect(parseDistinguishedNameAttributes(distinguishedName)).toEqual([
      {
        name: "cn",
        value:
          "cn=Passport Country Signing Authority,ou=APO,ou=DFAT,o=GOV,c=AU",
      },
      {
        name: "o",
        value: "cr",
      },
    ]);
    expect(objectType(distinguishedName)).toBe("cr");
    expect(sourceCountryCode(distinguishedName)).toBeNull();
  });
});
