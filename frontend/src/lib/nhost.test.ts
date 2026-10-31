import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  for (const name of [
    "VITE_NHOST_SUBDOMAIN",
    "VITE_NHOST_REGION",
    "VITE_NHOST_AUTH_URL",
    "VITE_NHOST_GRAPHQL_URL",
  ]) {
    vi.stubEnv(name, undefined);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public Nhost configuration", () => {
  it("defaults to the local project and uses the client's GraphQL endpoint", async () => {
    const { nhost, graphqlUrl } = await import("./nhost");
    expect(nhost.auth.baseURL).toBe("https://local.auth.local.nhost.run/v1");
    expect(graphqlUrl).toBe("https://local.graphql.local.nhost.run/v1");
    expect(graphqlUrl).toBe(nhost.graphql.url);
  });

  it.each([
    ["team-local", "local"],
    ["team-project", "eu-central-1"],
  ])("derives every service URL from %s / %s", async (subdomain, region) => {
    vi.stubEnv("VITE_NHOST_SUBDOMAIN", subdomain);
    vi.stubEnv("VITE_NHOST_REGION", region);
    const { nhost, graphqlUrl } = await import("./nhost");
    for (const service of ["auth", "graphql", "storage", "functions"] as const) {
      const url = service === "graphql" ? nhost.graphql.url : nhost[service].baseURL;
      expect(url).toBe(`https://${subdomain}.${service}.${region}.nhost.run/v1`);
    }
    expect(graphqlUrl).toBe(nhost.graphql.url);
  });

  it("keeps explicit test/custom endpoint overrides ahead of project defaults", async () => {
    vi.stubEnv("VITE_NHOST_SUBDOMAIN", "team-project");
    vi.stubEnv("VITE_NHOST_REGION", "eu-central-1");
    vi.stubEnv("VITE_NHOST_AUTH_URL", "http://127.0.0.1:18080/auth/v1/");
    vi.stubEnv("VITE_NHOST_GRAPHQL_URL", "http://127.0.0.1:18080/v1/graphql/");
    const { nhost, graphqlUrl } = await import("./nhost");
    expect(nhost.auth.baseURL).toBe("http://127.0.0.1:18080/auth/v1");
    expect(graphqlUrl).toBe("http://127.0.0.1:18080/v1/graphql");
    expect(graphqlUrl).toBe(nhost.graphql.url);
    expect(nhost.storage.baseURL).toBe("https://team-project.storage.eu-central-1.nhost.run/v1");
  });

  it("can override GraphQL alone without overriding the derived Auth URL", async () => {
    vi.stubEnv("VITE_NHOST_SUBDOMAIN", "team-local");
    vi.stubEnv("VITE_NHOST_REGION", "local");
    vi.stubEnv("VITE_NHOST_GRAPHQL_URL", "http://127.0.0.1:18080/v1/graphql");
    const { nhost, graphqlUrl } = await import("./nhost");
    expect(nhost.auth.baseURL).toBe("https://team-local.auth.local.nhost.run/v1");
    expect(graphqlUrl).toBe("http://127.0.0.1:18080/v1/graphql");
  });

  it("treats empty configuration as the local defaults", async () => {
    for (const name of [
      "VITE_NHOST_SUBDOMAIN",
      "VITE_NHOST_REGION",
      "VITE_NHOST_AUTH_URL",
      "VITE_NHOST_GRAPHQL_URL",
    ]) {
      vi.stubEnv(name, "");
    }
    const { nhost, graphqlUrl } = await import("./nhost");
    expect(nhost.auth.baseURL).toBe("https://local.auth.local.nhost.run/v1");
    expect(graphqlUrl).toBe("https://local.graphql.local.nhost.run/v1");
  });

  it.each(["VITE_NHOST_AUTH_URL", "VITE_NHOST_GRAPHQL_URL"])(
    "rejects credentials and non-HTTP URLs in %s",
    async (name) => {
      for (const value of [
        "https://user:password@example.com/v1",
        "https://user@example.com/v1",
        "file:///tmp/endpoint",
        "ftp://example.com/v1",
        "not-a-url",
      ]) {
        vi.resetModules();
        vi.stubEnv(name, value);
        await expect(import("./nhost")).rejects.toThrow();
      }
    },
  );
});
