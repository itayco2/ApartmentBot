import '../src/util/http.js';               // installs the shared dispatcher
import { request } from 'undici';

const url = 'https://www.madlan.co.il/for-rent/' + encodeURIComponent('מודיעין-מכבים-רעות-ישראל');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const plain: Record<string,string> = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
};
const hints: Record<string,string> = {
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
};
const secFetch: Record<string,string> = {
  'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1', 'Upgrade-Insecure-Requests': '1',
};
const verdict = (b: string) => /לחשוב שאתה רובוט|סליחה על ההפרעה/.test(b) ? 'BLOCK' : 'real page';

async function viaFetch(label: string, h: Record<string,string>) {
  const r = await fetch(url, { headers: h, redirect: 'follow' });
  const b = await r.text();
  console.log(`fetch   | ${label.padEnd(24)} ${r.status}  ${verdict(b)}  ${b.length}b`);
  await new Promise(x => setTimeout(x, 2500));
}
async function viaRequest(label: string, h: Record<string,string>) {
  const r = await request(url, { headers: h });
  const b = await r.body.text();
  console.log(`request | ${label.padEnd(24)} ${r.statusCode}  ${verdict(b)}  ${b.length}b`);
  await new Promise(x => setTimeout(x, 2500));
}

await viaRequest('plain', plain);
await viaRequest('plain+hints+secfetch', { ...plain, ...hints, ...secFetch });
await viaFetch('plain', plain);
await viaFetch('plain+hints', { ...plain, ...hints });
await viaFetch('plain+secfetch', { ...plain, ...secFetch });
await viaFetch('plain+hints+secfetch', { ...plain, ...hints, ...secFetch });
process.exit(0);
