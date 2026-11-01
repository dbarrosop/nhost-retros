import type { OAuth2LoginResponse } from "@nhost/nhost-js/auth";

function callbackUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid OAuth2 callback");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Invalid OAuth2 callback");
  }
  return url;
}

export function validateLoginRequest(request: OAuth2LoginResponse, requestId: string) {
  if (
    request.requestId !== requestId ||
    typeof request.clientId !== "string" ||
    !request.clientId ||
    !Array.isArray(request.scopes) ||
    !request.scopes.every((scope) => typeof scope === "string" && scope.length > 0)
  ) {
    throw new Error("Invalid OAuth2 request");
  }
  callbackUrl(request.redirectUri);
  return request;
}

export function consentRedirect(value: string, request: OAuth2LoginResponse) {
  const target = callbackUrl(value);
  const callback = callbackUrl(request.redirectUri);
  if (target.origin !== callback.origin || target.pathname !== callback.pathname) {
    throw new Error("OAuth2 callback changed");
  }
  // Keep Nhost's code, state and issuer intact. Never construct a redirect from page search params.
  return target.href;
}

export function consentFailure(error: unknown, approving = false) {
  const status = (error as { status?: number })?.status;
  if (status === 400 || status === 404 || status === 410) {
    return {
      message:
        "This request is invalid, expired or already used. Return to the application and start signing in again.",
      retry: false,
    };
  }
  if (status === 401 || status === 403) {
    return {
      message:
        "Your session could not authorize this request. Sign out and sign in again, or restart from the application.",
      retry: false,
    };
  }
  if (status === 429) {
    return { message: "Too many attempts. Wait a few minutes before trying again.", retry: true };
  }
  return {
    message: approving
      ? "We couldn’t complete authorization. Check your connection and try again. If it still fails, start a new request from the application."
      : "We couldn’t load this request. Check your connection and try again.",
    retry: true,
  };
}

export function scopeDescription(scope: string) {
  const descriptions: Record<string, string> = {
    openid: "Sign you in using your Nhost identity.",
    profile: "View your name, profile picture and locale.",
    email: "View your email address and verification status.",
    phone: "View your phone number and verification status.",
    offline_access: "Maintain access when you are not using the application.",
    graphql: "Access the GraphQL API with your account’s roles and permissions.",
  };
  if (scope.startsWith("graphql:role:")) {
    return `Access the GraphQL API with the “${scope.slice("graphql:role:".length)}” role.`;
  }
  return Object.hasOwn(descriptions, scope)
    ? descriptions[scope]
    : "Additional permission requested by this application.";
}
