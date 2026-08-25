import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync('assets/jarvis-avatar.svg', 'utf8');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await page.setContent(
  `<html><body style="margin:0;width:512px;height:512px">${svg}</body></html>`,
);
await page.screenshot({ path: 'assets/jarvis-avatar.png', clip: { x: 0, y: 0, width: 512, height: 512 } });
await browser.close();
console.log('rendered assets/jarvis-avatar.png');
process.exit(0);
