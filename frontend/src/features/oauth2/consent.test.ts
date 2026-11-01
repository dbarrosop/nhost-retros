import { describe, expect, it } from "vitest";
import { consentRedirect, scopeDescription, validateLoginRequest } from "./consent";

const request = {
  requestId: "550e8400-e29b-41d4-a716-446655440000",
  clientId: "nhoa_test",
  scopes: ["openid", "email"],
  redirectUri: "https://client.example/callback?existing=value",
};

describe("OAuth2 consent boundaries", () => {
  it("validates the request returned by Auth", () => {
    expect(validateLoginRequest(request, request.requestId)).toBe(request);
    expect(() => validateLoginRequest(request, "different-request")).toThrow();
    expect(() => validateLoginRequest({ ...request, clientId: "" }, request.requestId)).toThrow();
    expect(() => validateLoginRequest({ ...request, scopes: [""] }, request.requestId)).toThrow();
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "//other.example/callback",
    "/callback",
    "https://user:password@client.example/callback",
  ])("rejects unsafe callbacks: %s", (redirectUri) => {
    expect(() => validateLoginRequest({ ...request, redirectUri }, request.requestId)).toThrow();
    expect(() => consentRedirect(redirectUri, request)).toThrow();
  });

  it("preserves Auth's code, state, issuer and existing callback parameters", () => {
    const redirect =
      "https://client.example/callback?existing=value&code=one-time&state=a%2Bb&iss=https%3A%2F%2Fauth.example%2Fv1";
    expect(consentRedirect(redirect, request)).toBe(redirect);
    expect(() => consentRedirect("https://other.example/callback?code=secret", request)).toThrow();
    expect(() => consentRedirect("https://client.example/other?code=secret", request)).toThrow();
    const loopback = "http://127.0.0.1:12345/callback";
    expect(consentRedirect(`${loopback}?code=test`, { ...request, redirectUri: loopback })).toBe(
      `${loopback}?code=test`,
    );
  });

  it("describes offline_access as background access already included with every approval", () => {
    expect(scopeDescription("offline_access")).toBe(
      "Background access is included with every approval, with or without this scope.",
    );
  });

  it("describes GraphQL and unknown scopes without treating prototype keys as known scopes", () => {
    expect(scopeDescription("graphql")).toContain("roles and permissions");
    expect(scopeDescription("graphql:role:viewer")).toContain("“viewer” role");
    for (const scope of ["custom:read", "__proto__", "constructor"]) {
      expect(scopeDescription(scope)).toBe("Additional permission requested by this application.");
    }
  });
});
