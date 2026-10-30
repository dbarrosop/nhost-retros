import { request } from "./api.ts";
import { assert } from "./process.ts";
import type { Target } from "./target.ts";

// Mail never leaves this disposable stack. Do not log responses/codes or persist them.
export async function latestCode(target: Target, email: string) {
  const response = await request<{ items?: { Created: string; Content: { Body: string } }[] }>(
    target,
    `${target.endpoints.mail}/api/v2/search?kind=to&query=${encodeURIComponent(email)}&limit=50`,
  );
  assert(
    response.status === 200 && response.body.items?.length,
    "No disposable OTP email captured",
  );
  const messages = response.body.items.sort((a, b) => b.Created.localeCompare(a.Created));
  const code = messages[0].Content.Body.match(/>\s*([0-9]{6})\s*</)?.[1];
  assert(code, "Disposable OTP email did not contain a six-digit code");
  return code;
}
