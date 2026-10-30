import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { currentMetadata } from "./lib/api.ts";
import { Budget } from "./lib/auth.ts";
import {
  definition,
  endpoints,
  freePort,
  validateDockerHost,
  validateTarget,
} from "./lib/target.ts";

const valid = () => ({
  ...definition,
  databaseId: randomUUID(),
  endpoints: endpoints(definition.subdomain, definition.httpPort),
});

describe("disposable target guards", () => {
  it("accepts only the repository's explicitly registered isolated target", () => {
    expect(validateTarget(valid()).disposable).toBe(true);
    for (const input of [
      undefined,
      {},
      { ...valid(), disposable: false },
      { ...valid(), repository: "/another/repo" },
      { ...valid(), project: "backend" },
      { ...valid(), postgresPort: 5432 },
      { ...valid(), httpPort: 443 },
      { ...valid(), databaseId: "local" },
      { ...valid(), state: "/tmp/unregistered" },
    ]) {
      expect(() => validateTarget(input)).toThrow();
    }
  });

  it("refuses remote and ordinary developer endpoints, including URL credentials", () => {
    for (const url of [
      "https://project.nhost.run/v1",
      "https://local.graphql.local.nhost.run/v1",
      "http://localhost:443/v1",
      "http://admin:secret@127.0.0.1:18080/v1",
    ]) {
      const target = valid();
      target.endpoints.graphql = url;
      expect(() => validateTarget(target)).toThrow();
    }
  });

  it("refuses remote Docker endpoints even when another selector is local", () => {
    expect(() => validateDockerHost("unix:///var/run/docker.sock")).not.toThrow();
    for (const host of [undefined, "tcp://localhost:2375", "ssh://remote", "https://remote"]) {
      expect(() => validateDockerHost(host, "unix:///var/run/docker.sock")).toThrow();
    }
    expect(() => validateDockerHost("unix:///var/run/docker.sock", "tcp://remote:2375")).toThrow();
  });

  it("fails instead of choosing another port when the browser port is occupied", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen({ host: "::", port: 0 }, resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP address");
      await expect(freePort(address.port)).rejects.toThrow("occupied");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("counts rejected email requests and sign-ins before sending, with no retries", () => {
    const email = new Budget();
    for (let i = 0; i < 8; i++) email.spend("/signup/otp/email");
    expect(() => email.spend("/signin/otp/email")).toThrow("eight email-path");
    const signin = new Budget();
    for (let i = 0; i < 8; i++) signin.spend("/signin/email-password");
    expect(() => signin.spend("/signin/otp/email/verify")).toThrow("eight sign-in");
    const refresh = new Budget();
    for (let i = 0; i < 8; i++) refresh.spend("/token");
    expect(refresh.signin).toBe(0);
  });

  it("resolves checked-in metadata includes, not a hand-maintained Auth schema", () => {
    const metadata = currentMetadata();
    expect(metadata.version).toBe(3);
    expect(JSON.stringify(metadata.sources)).toContain('"schema":"auth"');
    expect(JSON.stringify(metadata)).not.toContain("!include");
  });
});
