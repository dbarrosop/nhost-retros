import { createNhostClient } from "@nhost/nhost-js";

export function publicEndpoint(value: string | undefined, fallback: string) {
  const url = new URL(value || fallback);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Invalid public Nhost endpoint");
  }
  return url.href.replace(/\/$/, "");
}

// All service URLs are explicit. This SPA never uses storage/functions or an admin session.
export const graphqlUrl = publicEndpoint(
  import.meta.env.VITE_NHOST_GRAPHQL_URL,
  "https://local.graphql.local.nhost.run/v1",
);
export const nhost = createNhostClient({
  authUrl: publicEndpoint(
    import.meta.env.VITE_NHOST_AUTH_URL,
    "https://local.auth.local.nhost.run/v1",
  ),
  graphqlUrl,
  storageUrl: "https://local.storage.local.nhost.run/v1",
  functionsUrl: "https://local.functions.local.nhost.run/v1",
  // AuthStore coordinates refresh/response acceptance so a late response cannot restore a signed-out identity.
  configure: [],
});
