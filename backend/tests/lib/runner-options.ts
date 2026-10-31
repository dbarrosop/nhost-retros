import { assert } from "./process.ts";
import { type Target, validateTarget } from "./target.ts";

export function targetAction(args: string[]) {
  const [action] = args;
  assert(
    args.length === 1 && ["provision", "health", "stop", "destroy"].includes(action),
    "Usage: pnpm test:target provision|health|stop|destroy (no target overrides)",
  );
  return action;
}

export function noTargetArgs(args: string[]) {
  assert(args.length === 0, "This acceptance command accepts no target overrides or arguments");
}

export function e2eEngine(args: string[]) {
  if (args.length === 0) return "constellation";
  assert(
    args.length === 2 && args[0] === "--engine" && ["constellation", "hasura"].includes(args[1]),
    "Usage: pnpm test:e2e [--engine constellation|hasura] (registered target only)",
  );
  return args[1];
}

export function e2eEndpoint(target: Target, engine: string | undefined) {
  validateTarget(target);
  assert(
    engine === "constellation" || engine === "hasura",
    "Missing/invalid acceptance engine; use pnpm test:e2e [--engine constellation|hasura]",
  );
  return engine === "hasura" ? target.endpoints.hasura : target.endpoints.graphql;
}
