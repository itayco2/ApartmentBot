import { describe, expect, it } from 'vitest';
import { detectBlockPage } from '../src/util/http.js';

describe('block page detection', () => {
  it('recognises the Radware captcha Yad2 serves today', () => {
    // Served with HTTP 200. Missing it meant JSON.parse failed quietly and the
    // largest source returned nothing with only a warning in the log.
    const html =
      '<head><title>Radware Bot Manager Captcha</title><script type="text/javascript">' +
      'window.SSJSInternal = 18531;</script></head>';
    expect(detectBlockPage(html)).toMatch(/Radware/);
  });

  it('still recognises the older Radware page title', () => {
    expect(detectBlockPage('<html><head><title>Radware Page</title></head></html>')).toMatch(/Radware/);
  });

  it('recognises the Madlan rate-limit page', () => {
    expect(detectBlockPage('<p>סליחה על ההפרעה, משהו בדפדפן גרם לנו לחשוב שאתה רובוט</p>')).not.toBeNull();
  });

  it('does not flag a Yad2 JSON body', () => {
    expect(detectBlockPage('{"data":{"markers":[{"token":"abc","price":6000}]}}')).toBeNull();
  });

  it('does not flag an ordinary listing page', () => {
    expect(detectBlockPage('<html><head><title>דירות להשכרה במודיעין</title></head><body>3 חדרים</body></html>')).toBeNull();
  });
});
