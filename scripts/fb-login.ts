/**
 * One-time Facebook sign-in for the bot.
 *
 * Opens a real Chrome window against the bot's own profile directory. You log
 * in by hand - the bot never sees the password - and the session cookies stay
 * in that directory so later runs are already signed in. Once the window is
 * closed the session is checked headlessly, so "did it work?" is answered
 * here rather than by a silent source hours later.
 *
 *   npm run fb-login
 */
import { isLoggedOut, openContext, USER_DATA_DIR } from '../src/sources/facebook/fbBrowser.js';

console.log(`Opening Chrome with the bot profile at ${USER_DATA_DIR}`);
console.log('Log in to Facebook in the window that opens, then close it.\n');

const context = await openContext(false);
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('https://www.facebook.com/');

console.log('Waiting for the window to be closed…');
await new Promise<void>((resolve) => {
  context.on('close', () => resolve());
});

console.log('Checking the saved session…');
const check = await openContext(true);
try {
  const probe = await check.newPage();
  await probe.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (await isLoggedOut(probe)) {
    console.log('\nFAIL: Facebook still shows a login page. Run `npm run fb-login` again and finish signing in.');
    process.exit(1);
  }
} finally {
  await check.close();
}

console.log('\nPASS: signed in. Now set FACEBOOK_ENABLED=1 in .env and restart the bot.');
process.exit(0);
