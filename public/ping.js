// Silent usage ping. Tells the feedback service "a real person used this app today", at most once a day per device.
// Include with: <script src="/ping.js" data-app="newsapp" data-version="1" data-endpoint="https://feedback.example/api/ping" defer></script>
//
// "Real person" means: not an automated browser or known bot, has touched/clicked/scrolled/typed, and has had the
// page visible for MIN_VISIBLE_S seconds. Nothing is sent before that, nothing is shown, and failures are ignored.
// Only a random device id (kept in localStorage) identifies a device. The only cookie is the optional ?nocount=1
// opt-out switch below; no IP is kept by the service.
//
// Optional hooks for the page:
//   window.pingCount('share')   count a feature use; the totals go out with the next ping
//   ?nocount=1 in the address (once per browser, in any of my apps) stops that browser being counted in all of them; ?nocount=0 undoes it
(function () {
  var script = document.currentScript;
  var APP = script && script.dataset.app;
  var ENDPOINT = script && script.dataset.endpoint;
  if (!APP || !ENDPOINT) return;
  var VERSION = (script.dataset.version || '').slice(0, 20);
  var MIN_VISIBLE_S = 10;
  var KEY = 'fb:' + APP;

  // Leave my own use out: never from a development address, and not from a browser I switched off by opening any of
  // my apps once with ?nocount=1 (?nocount=0 switches it back on). The switch is a cookie shared by every *.nocod.dev
  // app (and a localStorage flag as backup), so it only has to be done once per browser, e.g. on the home page.
  var OFF = 'fb:off', COOKIE = 'fb_off';
  var cookieDomain = /(^|\.)nocod\.dev$/.test(location.hostname) ? '; domain=.nocod.dev' : '';
  function setOff(on) {
    try { if (on) localStorage.setItem(OFF, '1'); else localStorage.removeItem(OFF); } catch (e) { /* ignore */ }
    try { document.cookie = COOKIE + '=' + (on ? '1; max-age=31536000' : '; max-age=0') + '; path=/; SameSite=Lax' + cookieDomain + (location.protocol === 'https:' ? '; Secure' : ''); } catch (e) { /* ignore */ }
  }
  function isOff() {
    try { if (localStorage.getItem(OFF)) return true; } catch (e) { /* ignore */ }
    return (' ' + document.cookie).indexOf(' ' + COOKIE + '=1') >= 0;
  }
  var q = /[?&]nocount=([01])/.exec(location.search);
  if (q) setOff(q[1] === '1');
  else if (isOff()) setOff(true);   // a flag from another app's address: keep this app's copy in step too
  if (isOff()) return;
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|.*\.local$)/.test(location.hostname)) return;

  var BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|phantom|puppeteer|playwright/i;
  if (navigator.webdriver || BOT.test(navigator.userAgent || '')) return;

  var state = {};
  function load() { try { state = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { state = {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: just don't ping */ } }
  load();

  var today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10); // device-local date
  if (!state.id) {
    state.id = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + String(Date.now());
    state.first = today;
  }
  if (!sessionStorage.getItem(KEY)) { // once per browser session
    try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }
    state.visits = (state.visits || 0) + 1;
  }
  save();

  var errors = 0;
  addEventListener('error', function () { errors++; });
  window.pingCount = function (name) {
    if (!/^[a-z0-9][a-z0-9_-]{0,29}$/.test(name)) return;
    load();
    state.feats = state.feats || {};
    state.feats[name] = (state.feats[name] || 0) + 1;
    save();
  };

  if (state.last === today) return; // already pinged today

  var interacted = false, visible = 0, sent = false;
  ['pointerdown', 'touchstart', 'keydown', 'scroll', 'wheel'].forEach(function (ev) {
    addEventListener(ev, function () { interacted = true; }, { passive: true, capture: true });
  });

  function platform() {
    var ua = navigator.userAgent;
    if (/android/i.test(ua)) return 'Android';
    if (/iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iOS';
    if (/windows/i.test(ua)) return 'Windows';
    if (/mac os/i.test(ua)) return 'macOS';
    if (/linux|cros/i.test(ua)) return 'Linux';
    return 'Other';
  }
  function browser() {
    var ua = navigator.userAgent;
    if (/edg\//i.test(ua)) return 'Edge';
    if (/samsungbrowser/i.test(ua)) return 'Samsung Internet';
    if (/firefox|fxios/i.test(ua)) return 'Firefox';
    if (/opr\/|opera/i.test(ua)) return 'Opera';
    if (/chrome|crios/i.test(ua)) return 'Chrome';
    if (/safari/i.test(ua)) return 'Safari';
    return 'Other';
  }

  function send() {
    if (sent) return;
    sent = true;
    load();
    var body = JSON.stringify({
      app: APP, v: VERSION, id: state.id, first: state.first, visits: state.visits || 1,
      installed: (matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true,
      platform: platform(), browser: browser(),
      w: screen.width, h: screen.height, lang: navigator.language,
      tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || ''),
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      secs: visible, errors: errors, feats: state.feats || {},
    });
    // text/plain keeps this a "simple" cross-origin request, so no preflight round trip
    var blob = new Blob([body], { type: 'text/plain' });
    var ok = false;
    try { ok = navigator.sendBeacon(ENDPOINT, blob); } catch (e) { /* fall through */ }
    if (!ok) { try { fetch(ENDPOINT, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true, mode: 'cors' }).catch(function () {}); } catch (e) { /* ignore */ } }
    state.last = today;
    state.feats = {}; // counts have been reported
    save();
  }

  var timer = setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    visible++;
    if (interacted && visible >= MIN_VISIBLE_S) { clearInterval(timer); send(); }
  }, 1000);
})();
