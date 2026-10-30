import { rmSync } from "node:fs";
import { main } from "../backend/tests/lib/process.ts";
import { compose, guard, locked, provision, state } from "../backend/tests/lib/target.ts";

await main(async () => {
  const action = process.argv[2];
  if (action === "provision") {
    await provision();
    console.log("Disposable target provisioned; developer stack untouched");
  } else if (action === "health") {
    const { health } = await import("../backend/tests/lib/api.ts");
    await health(await guard());
    console.log("Disposable target healthy");
  } else if (action === "stop") {
    await locked(async () => {
      const target = await guard();
      compose(target, ["stop"]);
    });
    console.log("Disposable services stopped; data retained");
  } else if (action === "destroy") {
    await locked(async () => {
      const target = await guard();
      compose(target, ["down", "--volumes", "--remove-orphans"]);
    });
    rmSync(state, { recursive: true });
    console.log("Registered disposable target removed; developer stack untouched");
  } else {
    throw new Error("Usage: pnpm test:target provision|health|stop|destroy (no developer resets)");
  }
});
