/* nadlan-bot widget - single-file, vanilla, no dependencies.
 * Embed:  <script src=".../widget.js" data-key="PUBLIC_KEY" data-surface="site"
 *                 data-endpoint="https://<ref>.supabase.co/functions/v1/bot"></script>
 *
 * Gate 1: this file NEVER touches a database. It only fetch()es the engine
 * endpoint. The only thing it knows is the public_key (an identifier, not a secret).
 *
 * Behavior (VP spec 14/07):
 *  - brand color #29A1D3 on bubble/header/avatar/chips/send.
 *  - closed bubble bottom-right (site's floating WhatsApp was removed - no collision).
 *  - teaser pops ONCE per visit: client-side time greeting + self-intro. No LLM on load.
 *  - on OPEN (click): static opening (greeting + self-intro + quick-reply chips). The
 *    LLM fires only when the visitor picks a chip or types - never on page load / open.
 */
(function () {
  'use strict';
  // document.currentScript is the reliable path for a static <script> tag (WordPress).
  // When loaded async (next/script, GTM, etc.) currentScript is null at run time, so
  // fall back to locating our own tag by its data attributes. Makes the widget robust
  // to any async/deferred loader, not just Next.js.
  var s = document.currentScript || document.querySelector('script[data-key][data-endpoint]');
  var KEY = s && s.getAttribute('data-key');
  var SURFACE = (s && s.getAttribute('data-surface')) || 'site';
  var ENDPOINT = s && s.getAttribute('data-endpoint');
  if (!KEY || !ENDPOINT) { console.error('[nadlan-bot] missing data-key or data-endpoint'); return; }

  var BRAND = '#29A1D3';
  var BRAND_DK = '#2189b8';

  var LS_CONV = 'nb_conv_' + KEY;
  var LS_VIS = 'nb_vis_' + KEY;
  var SS_TEASER = 'nb_teaser_' + KEY; // once per visit (sessionStorage)
  function uid() { try { return crypto.randomUUID(); } catch (e) { return 'v-' + Date.now() + '-' + Math.floor(1e9 * (0.5)); } }
  var visitor = localStorage.getItem(LS_VIS); if (!visitor) { visitor = uid(); localStorage.setItem(LS_VIS, visitor); }
  var conversationId = localStorage.getItem(LS_CONV) || null;

  // client-side time-of-day greeting (Israel-style; uses the visitor's local clock, free, no LLM)
  function greeting() {
    var h = new Date().getHours();
    if (h >= 5 && h < 12) return 'בוקר טוב';
    if (h >= 12 && h < 18) return 'צהריים טובים';
    if (h >= 18 && h < 22) return 'ערב טוב';
    return 'לילה טוב';
  }
  // Per-surface identity. Same public sales bot, a different face per surface:
  // site = Gilad's virtual assistant; academy = the learning advisor. Extend later.
  // Per-surface identity + quick-reply chips. Same public sales bot, a different
  // face + intent set per surface: site = Gilad's assistant (buy/sell/learn);
  // academy = the learning advisor (learning-path chips). chip label -> first message.
  var IDENTITY = {
    site: {
      intro: 'אני העוזר הווירטואלי של גלעד ארז, מייסד השיטה.', name: 'העוזר של גלעד ארז', sub: 'מייסד השיטה', avatar: 'גא',
      chips: [
        { label: 'קונה', msg: 'אני רוצה לקנות נכס' },
        { label: 'מוכר', msg: 'אני רוצה למכור נכס' },
        { label: 'ללמוד', msg: 'אני רוצה ללמוד על נדל"ן' },
        { label: 'שאלה', msg: 'יש לי שאלה' }
      ]
    },
    academy: {
      intro: 'אני היועץ הלימודי של נדל״ן ישראלי.', name: 'היועץ הלימודי', sub: 'נדל״ן ישראלי', avatar: 'יל',
      chips: [
        { label: 'ידע כללי', msg: 'אני רוצה ידע כללי בנדל״ן' },
        { label: 'למידה + יישום', msg: 'אני רוצה ללמוד וגם ליישם בפועל' },
        { label: 'קורס מקצועי', msg: 'אני רוצה לעסוק בנדל״ן מקצועית' },
        { label: 'שאלה', msg: 'יש לי שאלה' }
      ]
    }
  };
  var ID = IDENTITY[SURFACE] || IDENTITY.site;
  var INTRO = ID.intro;
  var CHIPS = ID.chips;

  var css = [
    '#nb-bubble{position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;background:' + BRAND + ';color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 6px 20px rgba(41,161,211,.45);z-index:2147483000;transition:transform .15s ease}',
    '#nb-bubble:hover{transform:scale(1.06)}',
    '#nb-bubble svg{width:30px;height:30px}',
    '#nb-teaser{position:fixed;bottom:92px;right:20px;width:270px;max-width:calc(100vw - 40px);background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:14px 16px 14px 14px;z-index:2147483000;direction:rtl;font-family:system-ui,Arial,sans-serif;display:none;cursor:pointer;animation:nbpop .25s ease}',
    '#nb-teaser.nb-show{display:block}',
    '@keyframes nbpop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
    '#nb-teaser .nb-tt{font-size:14px;line-height:1.5;color:#1a2733}',
    '#nb-teaser .nb-tx{position:absolute;top:6px;left:8px;color:#9aa7b2;font-size:16px;line-height:1;cursor:pointer;padding:4px}',
    '#nb-panel{position:fixed;bottom:92px;right:20px;width:360px;max-width:calc(100vw - 40px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;z-index:2147483000;direction:rtl;font-family:system-ui,Arial,sans-serif}',
    '#nb-panel.nb-open{display:flex}',
    '#nb-head{background:' + BRAND + ';color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px}',
    '#nb-av{width:38px;height:38px;border-radius:50%;background:#fff;color:' + BRAND + ';display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex:0 0 auto}',
    '#nb-htxt{flex:1;min-width:0}',
    '#nb-htxt b{display:block;font-size:15px;font-weight:600}',
    '#nb-htxt span{display:block;font-size:12px;opacity:.9}',
    '#nb-close{background:none;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;opacity:.9}',
    '#nb-close:hover{opacity:1}',
    '#nb-log{flex:1;overflow-y:auto;padding:14px;background:#f4f7f9}',
    '.nb-msg{margin:7px 0;padding:10px 13px;border-radius:14px;max-width:84%;white-space:pre-wrap;line-height:1.5;font-size:14px;word-wrap:break-word}',
    '.nb-user{background:' + BRAND + ';color:#fff;margin-left:auto;border-bottom-right-radius:5px}',
    '.nb-bot{background:#fff;color:#15202b;border:1px solid #e4e9ee;margin-right:auto;border-bottom-left-radius:5px}',
    '#nb-chips{display:flex;flex-wrap:wrap;gap:8px;padding:2px 2px 6px;margin-right:2px}',
    '.nb-chip{border:1.5px solid ' + BRAND + ';color:' + BRAND + ';background:#fff;border-radius:999px;padding:7px 15px;font-size:14px;cursor:pointer;font-family:inherit;transition:background .12s,color .12s}',
    '.nb-chip:hover{background:' + BRAND + ';color:#fff}',
    '.nb-dots{display:inline-block}',
    '.nb-dots i{display:inline-block;width:6px;height:6px;margin:0 1px;border-radius:50%;background:#9aa7b2;animation:nbb 1s infinite}',
    '.nb-dots i:nth-child(2){animation-delay:.15s}.nb-dots i:nth-child(3){animation-delay:.3s}',
    '@keyframes nbb{0%,60%,100%{opacity:.3}30%{opacity:1}}',
    '#nb-form{display:flex;border-top:1px solid #e4e9ee;background:#fff}',
    '#nb-input{flex:1;border:0;padding:13px;font-size:14px;outline:none;font-family:inherit;background:transparent}',
    '#nb-send{border:0;background:' + BRAND + ';color:#fff;padding:0 18px;cursor:pointer;font-size:14px;font-weight:600}',
    '#nb-send:hover{background:' + BRAND_DK + '}',
    // mobile: keep the panel contained (not full-screen) so the page stays visible behind it
    '@media (max-width:480px){#nb-panel{width:calc(100vw - 20px);right:10px;bottom:82px;height:70vh;max-height:70vh}#nb-teaser{right:10px;width:calc(100vw - 90px)}}'
  ].join('\n');
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var CHAT_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var bubble = document.createElement('div'); bubble.id = 'nb-bubble'; bubble.setAttribute('aria-label', 'פתחו צ\'אט'); bubble.innerHTML = CHAT_SVG;

  var teaser = document.createElement('div'); teaser.id = 'nb-teaser';
  teaser.innerHTML = '<span class="nb-tx" id="nb-tx">×</span><div class="nb-tt">' + greeting() + ', ' + INTRO + ' במה אוכל לעזור?</div>';

  var panel = document.createElement('div'); panel.id = 'nb-panel';
  panel.innerHTML =
    '<div id="nb-head"><div id="nb-av">' + ID.avatar + '</div><div id="nb-htxt"><b>' + ID.name + '</b><span>' + ID.sub + '</span></div><button id="nb-close" type="button" aria-label="סגירה">×</button></div>' +
    '<div id="nb-log"></div>' +
    '<form id="nb-form"><input id="nb-input" placeholder="כתבו הודעה..." autocomplete="off"><button id="nb-send" type="submit">שלח</button></form>';

  document.body.appendChild(bubble);
  document.body.appendChild(teaser);
  document.body.appendChild(panel);

  var log = panel.querySelector('#nb-log');
  var form = panel.querySelector('#nb-form');
  var input = panel.querySelector('#nb-input');
  var opened = false;

  function add(role, text) {
    var d = document.createElement('div');
    d.className = 'nb-msg ' + (role === 'user' ? 'nb-user' : 'nb-bot');
    d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight;
    return d;
  }
  function typing() {
    var d = document.createElement('div');
    d.className = 'nb-msg nb-bot';
    d.innerHTML = '<span class="nb-dots"><i></i><i></i><i></i></span>';
    log.appendChild(d); log.scrollTop = log.scrollHeight;
    return d;
  }

  function renderChips() {
    var wrap = document.createElement('div'); wrap.id = 'nb-chips';
    CHIPS.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'nb-chip'; b.textContent = c.label;
      b.addEventListener('click', function () { wrap.remove(); send(c.msg); });
      wrap.appendChild(b);
    });
    log.appendChild(wrap); log.scrollTop = log.scrollHeight;
  }

  // static opening - no LLM. IDENTICAL to the teaser (one consistent self-intro), then
  // the quick-reply chips. The bot's opening rule no longer re-introduces (widget owns it).
  function openingMessage() {
    add('bot', greeting() + ', ' + INTRO + ' במה אוכל לעזור?');
    renderChips();
  }

  function hideTeaser() { teaser.classList.remove('nb-show'); }
  function openPanel() {
    hideTeaser();
    panel.classList.add('nb-open');
    if (!opened) { opened = true; openingMessage(); }
    input.focus();
  }
  function closePanel() { panel.classList.remove('nb-open'); }

  bubble.addEventListener('click', function () {
    if (panel.classList.contains('nb-open')) closePanel(); else openPanel();
  });
  panel.querySelector('#nb-close').addEventListener('click', closePanel);
  teaser.addEventListener('click', openPanel);
  teaser.querySelector('#nb-tx').addEventListener('click', function (e) { e.stopPropagation(); hideTeaser(); });

  // Sends the message and consumes an SSE stream: the reply text types in live as the
  // bot generates it, then a final event carries the authoritative reply + conversation_id.
  function send(text) {
    text = String(text || '').trim(); if (!text) return;
    var chips = log.querySelector('#nb-chips'); if (chips) chips.remove();
    add('user', text);
    var pending = typing();
    var streamed = '';
    function handle(obj) {
      if (obj.delta) {
        if (!streamed) pending.textContent = '';
        streamed += obj.delta;
        pending.textContent = streamed;
        log.scrollTop = log.scrollHeight;
      } else if (obj.final) {
        if (obj.final.conversation_id) { conversationId = obj.final.conversation_id; localStorage.setItem(LS_CONV, conversationId); }
        pending.textContent = obj.final.reply || streamed || 'מצטער, אירעה תקלה.';
        log.scrollTop = log.scrollHeight;
      } else if (obj.error) {
        pending.textContent = obj.error === 'rate_limited' ? 'רגע אחד, נסו שוב עוד רגע.' : 'מצטער, אירעה תקלה.';
      }
    }
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ public_key: KEY, surface: SURFACE, message: text, conversation_id: conversationId, visitor_id: visitor, stream: true })
    }).then(function (r) {
      if (!r.ok || !r.body) throw new Error('bad response');
      var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
      function pump() {
        return reader.read().then(function (res) {
          if (res.done) return;
          buf += dec.decode(res.value, { stream: true });
          var parts = buf.split('\n\n'); buf = parts.pop();
          parts.forEach(function (block) {
            var line = null;
            block.split('\n').forEach(function (l) { if (l.indexOf('data:') === 0) line = l.slice(5).trim(); });
            if (!line) return;
            var obj; try { obj = JSON.parse(line); } catch (e) { return; }
            handle(obj);
          });
          return pump();
        });
      }
      return pump();
    }).catch(function () { if (!streamed) pending.textContent = 'מצטער, אירעה תקלה. נסו שוב.'; });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim(); if (!text) return;
    input.value = ''; send(text);
  });

  // teaser once per visit: show shortly after load, only if the panel isn't open.
  try {
    if (!sessionStorage.getItem(SS_TEASER)) {
      sessionStorage.setItem(SS_TEASER, '1');
      setTimeout(function () { if (!panel.classList.contains('nb-open')) teaser.classList.add('nb-show'); }, 1400);
    }
  } catch (e) { /* sessionStorage blocked - skip teaser */ }
})();
