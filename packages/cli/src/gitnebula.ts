// Executable entry for the `gitnebula` binary (tsup adds the shebang).

import { main } from "./cli.js";

await main(process.argv.slice(2));
