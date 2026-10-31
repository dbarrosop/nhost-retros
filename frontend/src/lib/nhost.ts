import { createNhostClient } from "@nhost/nhost-js";

export function publicEndpoint(value: string | undefined) {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid public Nhost endpoint");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Invalid public Nhost endpoint");
  }
  return url.href.replace(/\/$/, "");
}

export const nhost = createNhostClient({
  subdomain: import.meta.env.VITE_NHOST_SUBDOMAIN || "local",
  region: import.meta.env.VITE_NHOST_REGION || "local",
  // Optional overrides support custom domains and the isolated dual-engine tests.
  authUrl: publicEndpoint(import.meta.env.VITE_NHOST_AUTH_URL),
  graphqlUrl: publicEndpoint(import.meta.env.VITE_NHOST_GRAPHQL_URL),
  // AuthStore coordinates refresh/response acceptance so a late response cannot restore a signed-out identity.
  configure: [],
});

// Direct requests and SDK requests must use the same resolved GraphQL endpoint.
export const graphqlUrl = nhost.graphql.url;
