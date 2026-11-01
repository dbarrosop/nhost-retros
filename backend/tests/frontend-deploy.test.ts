import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const sandboxes: string[] = [];
afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

function deploy(env: Record<string, string> = {}, args: string[] = []) {
  const cwd = mkdtempSync(join(tmpdir(), "retro-frontend-deploy-"));
  sandboxes.push(cwd);
  mkdirSync(join(cwd, "scripts"));
  mkdirSync(join(cwd, "bin"));
  copyFileSync(new URL("../../Makefile", import.meta.url), join(cwd, "Makefile"));
  copyFileSync(
    new URL("../../scripts/deploy-frontend.sh", import.meta.url),
    join(cwd, "scripts/deploy-frontend.sh"),
  );
  for (const command of ["pnpm", "wrangler"]) {
    writeFileSync(
      join(cwd, "bin", command),
      `#!/bin/sh\nprintf '%s\\n' "$@" > '${cwd}/${command}.args'\nexit "\${${command === "pnpm" ? "BUILD_STATUS" : "DEPLOY_STATUS"}:-0}"\n`,
      { mode: 0o755 },
    );
  }
  const result = spawnSync("make", ["--no-print-directory", "deploy-frontend", ...args], {
    cwd,
    encoding: "utf8",
    // Never inherit Cloudflare credentials or developer backend selection.
    env: {
      PATH: `${cwd}/bin:${process.env.PATH}`,
      VITE_NHOST_SUBDOMAIN: "cloud-project",
      VITE_NHOST_REGION: "eu-central-1",
      ...env,
    },
  });
  const calls = (command: string) => {
    const path = join(cwd, `${command}.args`);
    return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n") : [];
  };
  return { ...result, build: calls("pnpm"), wrangler: calls("wrangler") };
}

describe("frontend deployment target", () => {
  it("builds first and deploys retros to the existing namespace without managing routes", () => {
    const result = deploy();
    expect(result.status).toBe(0);
    expect(result.build).toEqual(["--filter", "@retro/frontend", "build"]);
    expect(result.wrangler).toEqual([
      "deploy",
      "--config",
      "frontend/wrangler.toml",
      "--dispatch-namespace",
      "nhost-app",
      "--name",
      "retros",
    ]);
  });

  it("accepts environment overrides and forwards dry-run arguments", () => {
    const result = deploy(
      { FRONTEND_DOMAIN: "retro-preview.nhost.app", CLOUDFLARE_DISPATCH_NAMESPACE: "preview" },
      ["WRANGLER_DEPLOY_ARGS=--dry-run"],
    );
    expect(result.status).toBe(0);
    expect(result.wrangler.slice(-5)).toEqual([
      "--dispatch-namespace",
      "preview",
      "--name",
      "retro-preview",
      "--dry-run",
    ]);
  });

  it.each([
    "",
    "retros.example.com",
    "https://retros.nhost.app",
    "retros.nhost.app/path",
    "nested.retros.nhost.app",
    "-retros.nhost.app",
    "retros-.nhost.app",
    "Retros.nhost.app",
    "retros;exit 0.nhost.app",
    `${"r".repeat(64)}.nhost.app`,
  ])("refuses unsupported hostname %j before building or deploying", (domain) => {
    const result = deploy({ FRONTEND_DOMAIN: domain });
    expect(result.status).not.toBe(0);
    expect(result.build).toEqual([]);
    expect(result.wrangler).toEqual([]);
  });

  it("refuses an empty dispatch namespace", () => {
    const result = deploy({ CLOUDFLARE_DISPATCH_NAMESPACE: "" });
    expect(result.status).not.toBe(0);
    expect(result.build).toEqual([]);
    expect(result.wrangler).toEqual([]);
  });

  it.each(["", "local"])("refuses implicit/local backend selection %j", (value) => {
    const result = deploy({ VITE_NHOST_SUBDOMAIN: value, VITE_NHOST_REGION: value });
    expect(result.status).not.toBe(0);
    expect(result.build).toEqual([]);
    expect(result.wrangler).toEqual([]);
  });

  it("accepts a complete pair of custom HTTPS backend endpoints", () => {
    const result = deploy({
      VITE_NHOST_SUBDOMAIN: "",
      VITE_NHOST_REGION: "",
      VITE_NHOST_AUTH_URL: "https://auth.example.com/v1",
      VITE_NHOST_GRAPHQL_URL: "https://graphql.example.com/v1",
    });
    expect(result.status).toBe(0);
    expect(result.wrangler).toContain("retros");
  });

  it("refuses incomplete custom endpoints without a cloud project", () => {
    const result = deploy({
      VITE_NHOST_SUBDOMAIN: "",
      VITE_NHOST_AUTH_URL: "https://auth.example.com/v1",
    });
    expect(result.status).not.toBe(0);
    expect(result.build).toEqual([]);
    expect(result.wrangler).toEqual([]);
  });

  it("never uploads after a failed build and propagates deployment failures", () => {
    const buildFailure = deploy({ BUILD_STATUS: "1" });
    expect(buildFailure.status).not.toBe(0);
    expect(buildFailure.build).toContain("build");
    expect(buildFailure.wrangler).toEqual([]);
    const uploadFailure = deploy({ DEPLOY_STATUS: "1" });
    expect(uploadFailure.status).not.toBe(0);
    expect(uploadFailure.wrangler).toContain("retros");
  });
});
