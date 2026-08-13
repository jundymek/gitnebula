// The browser hand-off (FR-5). One line of real work, in its own module so
// `cli.ts` can be tested without ever launching anything: the caller injects a
// fake, and the default is this.
import open from "open";

/** Opens `url` in the user's default browser. */
export async function openBrowser(url: string): Promise<void> {
  await open(url);
}
