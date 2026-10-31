import { rmSync } from "node:fs";
import { main } from "../backend/tests/lib/process.ts";
import { targetAction } from "../backend/tests/lib/runner-options.ts";
import { compose, guard, locked, provision, state } from "../backend/tests/lib/target.ts";

await main(async () => {
  const action = targetAction(process.argv.slice(2));
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
      await compose(target, ["stop"]);
    });
    console.log("Disposable services stopped; data retained");
  } else if (action === "destroy") {
    await locked(async () => {
      const target = await guard();
      await compose(target, ["down", "--volumes", "--remove-orphans"]);
    });
    rmSync(state, { recursive: true });
    console.log("Registered disposable target removed; developer stack untouched");
  }
});
