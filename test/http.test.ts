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

  it('recognises the JSON firewall record Yad2 answers a rejected query with', () => {
    // Any unexpected query parameter gets this instead of data. It is valid JSON, so without
    // a marker it would parse as an empty city. The real record carries the caller's public
    // IP; this one uses a documentation address.
    const record =
      '{\n\t"_event_transid" : 2946802998,\n\t"_event_clientip" : "203.0.113.7",\n\t"_event_clientport" : 13750\n}';
    expect(detectBlockPage(record)).toBe('Radware firewall event');
  });

  it('does not flag a Yad2 JSON body', () => {
    expect(detectBlockPage('{"data":{"markers":[{"token":"abc","price":6000}]}}')).toBeNull();
  });

  it('does not flag an ordinary listing page', () => {
    expect(detectBlockPage('<html><head><title>דירות להשכרה במודיעין</title></head><body>3 חדרים</body></html>')).toBeNull();
  });
});
