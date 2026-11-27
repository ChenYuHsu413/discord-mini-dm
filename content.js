(() => {
  const root = document.documentElement;
  const key = 'mini-dm-enabled';
  let enabled = sessionStorage.getItem(key) !== 'off';
  const button = document.createElement('button');
  button.id = 'mini-dm-toggle'; button.type = 'button';
  let selfName = '';
  const selector = 'li[id^="chat-messages-"]';
  const known = new Map();
  let channel = '', scheduled = false, ready = false, list = null, dirty = new Set(), fullScan = true;
  let observer, shellObserver;
  const setData = (el, key, value) => { if (value) { if (el.dataset[key] !== value) el.dataset[key] = value; } else if (key in el.dataset) delete el.dataset[key]; };
  const ownUI = el => !!el?.closest?.('#mini-tools,#mini-dm-toggle');
  const direct = (el, sel) => el && Array.from(el.children).find(child => child.matches(sel));
  // Without a known self name, leave messages unclassified (native layout).
  const classify = name => !selfName ? '' : name.trim().toLowerCase() === selfName ? 'self' : 'other';
  const debug = (...args) => { try { if (localStorage.getItem('mini-dm-debug') === '1') console.debug('[MiniDM]', ...args); } catch {} };
  function detectSelfName() {
    // The user panel (bottom-left) stays in the DOM even when hidden by minimal mode.
    try {
      const panel = document.querySelector('[class*="panels_"]');
      for (const sel of ['[class*="nameTag_"] [class*="panelTitleContainer_"]', '[class*="nameTag_"] [class*="title_"]', '[class*="panelTitleContainer_"]']) {
        const text = panel?.querySelector(sel)?.textContent.trim();
        if (text) return text;
      }
    } catch {}
    return '';
  }
  function refreshSelf() {
    const input = document.getElementById('mini-self-name');
    const configured = input?.value.trim() || '';
    const detected = configured ? '' : detectSelfName();
    const next = (configured || detected).toLowerCase();
    if (input) { const hint = detected ? '自動偵測：' + detected : '偵測不到，請手動填寫'; if (input.placeholder !== hint) input.placeholder = hint; }
    const btn = document.getElementById('mini-settings-btn');
    if (btn) { setData(btn, 'miniNeedSelf', next ? '' : 'true'); const title = next ? '設定' : '設定（請填寫「我的顯示名稱」）'; if (btn.title !== title) btn.title = title; }
    if (next === selfName) return false;
    selfName = next; known.clear(); fullScan = true;
    return true;
  }
  // Discord rewrites <html> class/style (focus/blur, theme), so state lives in data attributes and a <style>.
  const want = {miniActive:'', miniCompact:'', miniTheme:''};
  const vars = document.createElement('style'); vars.id = 'mini-dm-vars';
  function sync() {
    for (const k in want) setData(root, k, want[k]);
    if (!vars.isConnected) (document.head || root).append(vars);
  }
  const guard = new MutationObserver(records => {
    for (const r of records) {
      if (r.type !== 'attributes') continue;
      if (r.attributeName === 'class' || r.attributeName === 'style') { debug('html attr rewritten', r.attributeName, r.oldValue); continue; }
      const k = r.attributeName.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase());
      if ((root.dataset[k] || '') !== want[k]) debug('html attr clobbered', r.attributeName, r.oldValue);
    }
    sync();
  });
  guard.observe(root, {attributes:true, attributeOldValue:true, attributeFilter:['class','style','data-mini-active','data-mini-compact','data-mini-theme']});
  if (document.head) guard.observe(document.head, {childList:true});
  function explicitAuthor(msg, contents, id) {
    // The reply preview is outside the actual message contents/header.
    const header = direct(contents, '[class*="header_"]');
    const author = header?.querySelector('[class*="username_"]');
    if (author?.textContent.trim()) return classify(author.textContent);
    const own = document.getElementById('message-username-' + id);
    if (own && contents?.contains(own) && own.textContent.trim()) return classify(own.textContent);
    // Grouped messages may refer to the author of their group through ARIA.
    for (const token of (msg.getAttribute('aria-labelledby') || '').split(/\s+/)) {
      const match = /^message-username-(\d+)$/.exec(token);
      if (!match) continue;
      const el = document.getElementById(token);
      if (el?.textContent.trim() && el.closest('[class*="contents_"]') && !el.closest('[class*="repliedMessage_"]')) return classify(el.textContent);
      if (known.has(match[1])) return known.get(match[1]);
    }
    return '';
  }
  function update() {
    scheduled = false;
    const dm = /^\/channels\/@me\/\d+\/?$/.test(location.pathname);
    if (!ready) return;
    refreshSelf();
    if (channel !== location.pathname) { channel = location.pathname; known.clear(); fullScan = true; if (dm) chrome.runtime.sendMessage({type:'mini-last-dm',url:location.origin+location.pathname}).catch(()=>{}); }
    bindList();
    want.miniActive = dm && enabled ? 'true' : ''; sync();
    button.hidden = !dm;
    document.getElementById("mini-tools").hidden = !dm || !enabled;
    refreshExtras();
    const label = enabled ? '完整介面' : '極簡模式';
    if (button.textContent !== label) button.textContent = label;
    if (button.getAttribute('aria-pressed') !== String(enabled)) button.setAttribute('aria-pressed', String(enabled));
    
    if (!dm || !enabled) return;
    if (!list || (!fullScan && !dirty.size)) return;
    const rows = Array.from(list.querySelectorAll(selector));
    const changed = dirty; dirty = new Set();
    const all = fullScan; fullScan = false;
    let side = '';
    let propagate = false;
    for (const item of rows) {
      if (!all && !changed.has(item) && !propagate) { side = item.dataset.miniSide || ''; continue; }
      const oldSide = item.dataset.miniSide || '';
      propagate = false;
      const msg = item.querySelector('[class*="message_"][class*="cozy_"]');
      const id = item.id.match(/(\d+)$/)?.[1];
      if (!msg || !id) { side = ''; setData(item, 'miniSide', ''); propagate = !!oldSide; continue; }
      const contents = direct(msg, '[class*="contents_"]');
      const start = msg.className.includes('groupStart_') || !!direct(contents, '[class*="header_"]');
      const explicit = explicitAuthor(msg, contents, id);
      if (explicit) { side = explicit; known.set(id, side); }
      else if (start || msg.querySelector('[class*="repliedMessage_"]')) side = known.get(id) || '';
      else if (!side && known.has(id)) side = known.get(id);
      if (side) known.set(id, side);
      // Only inherit within a visible continuation; unknown boundaries remain native.
      setData(item, 'miniSide', side);
      propagate = side !== oldSide;
      for (const child of msg.children) {
        const accessory = child.id === 'message-accessories-' + id || child.matches('[class*="container_"]') && !!child.querySelector('[class*="attachment_"],[class*="imageWrapper_"],[class*="embed_"],[class*="mediaAttachmentsContainer_"],[class*="sticker_"]');
        setData(child, 'miniAccessory', accessory ? 'true' : '');
      }
    }
    if (known.size > 3000) { for (const id of Array.from(known.keys()).slice(0,1000)) known.delete(id); }
  }
  function bindList() {
    const next = document.querySelector('[data-list-id="chat-messages"]') || document.querySelector('ol[class*="scrollerInner_"]:has(li[id^="chat-messages-"])') || document.querySelector(selector)?.parentElement || null;
    if (next === list) return;
    observer?.disconnect(); list = next; dirty.clear(); fullScan = true;
    if (!list) return;
    observer = new MutationObserver(records => {
      for (const r of records) {
        const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        const row = el?.closest(selector);
        if (row) dirty.add(row);
        else if (r.type === 'childList') {
          for (const node of r.addedNodes) if (node.nodeType === 1) {
            if (node.matches(selector)) dirty.add(node);
            node.querySelectorAll(selector).forEach(x => dirty.add(x));
          }
          // Removal can change the visible continuation boundary.
          if (r.removedNodes.length) fullScan = true;
        }
      }
      if (dirty.size || fullScan) schedule();
    });
    observer.observe(list, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['aria-labelledby','id']});
  }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(update); } }
  function toggle() { fullScan = true; enabled = !enabled; sessionStorage.setItem(key, enabled ? 'on' : 'off'); update(); }
  button.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  document.body.append(button);
  setupExtras();
  document.addEventListener('keydown', e => { if (e.altKey && e.shiftKey && e.code === 'KeyM' && !button.hidden) { e.preventDefault(); toggle(); } });
  // Watch only structural changes outside the message list, not hover/focus churn.
  shellObserver = new MutationObserver(records => {
    if (location.pathname !== channel || (list && !list.isConnected)) { schedule(); return; }
    for (const r of records) {
      if (ownUI(r.target) || list?.contains(r.target)) continue;
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1 || ownUI(n)) continue;
        if (n.matches('[data-list-id="chat-messages"],[class*="title_"],[class*="newMessagesBar_"],[class*="unreadPill_"]') || n.querySelector('[data-list-id="chat-messages"],li[id^="chat-messages-"],[class*="title_"],[class*="newMessagesBar_"],[class*="unreadPill_"]')) { schedule(); return; }
      }
      if (r.removedNodes.length && !list) { schedule(); return; }
    }
  });
  shellObserver.observe(document.body, {childList:true,subtree:true});
  window.addEventListener('popstate', schedule);
  window.addEventListener('pageshow', schedule);
  window.addEventListener('focus', schedule);
  window.addEventListener('blur', schedule);
  document.addEventListener('visibilitychange', schedule);
  // A lightweight route check only; never periodically rescan messages.
  setInterval(() => { if (location.pathname !== channel || (list && !list.isConnected)) schedule(); }, 1000);
  setInterval(() => { if (!document.getElementById('mini-dashboard').hidden) refreshExtras(); }, 30000);
  update();
  function setupExtras() {
    const tools = document.createElement('div'); tools.id='mini-tools';
    tools.innerHTML='<span id="mini-unread" hidden>新訊息</span><button type="button" id="mini-open">小視窗</button><button type="button" id="mini-dash-btn">工作台</button><button type="button" id="mini-settings-btn" aria-label="設定">⚙</button><section id="mini-settings" hidden><label>我的顯示名稱 <input id="mini-self-name" maxlength="64" placeholder="自動偵測"></label><label>聊天室暱稱（僅本機顯示）<input id="mini-nick" maxlength="40" placeholder="原始名稱"></label><label>文字大小 <input id="mini-font" type="number" min="11" max="20" value="13"></label><label>外觀模式 <select id="mini-theme"><option value="native">跟隨 Discord</option><option value="light">極簡淺色</option><option value="custom">自訂顏色</option></select></label><label>自己的氣泡 <input id="mini-self-color" type="color" value="#dceafb"></label><label>對方的氣泡 <input id="mini-other-color" type="color" value="#eceef1"></label><label>背景 <input id="mini-bg" type="color" value="#f8f8f8"></label><label><input id="mini-compact" type="checkbox" checked> 緊湊模式</label><button id="mini-reset" type="button">恢復預設</button></section><section id="mini-dashboard" hidden><strong>私人工作台</strong><label>下班時間 <input type="time" id="mini-end" value="18:00"></label><div id="mini-clock"></div><div>ETF 行情（外部連結）</div><div id="mini-etfs"></div><div><a href="https://pathofexile2.com/" target="_blank" rel="noopener noreferrer">POE2 官網</a> · <a href="https://devilcatpoe.com/" target="_blank" rel="noopener noreferrer">攻略</a> · <a href="https://lolesports.com/" target="_blank" rel="noopener noreferrer">LoL Esports</a></div><label>私人筆記<textarea id="mini-note" rows="3"></textarea></label></section>';
    document.body.append(tools);
    const get = id => document.getElementById(id);
    const defaults={'mini-self-name':'','mini-theme':'native','mini-nick':'','mini-font':'13','mini-self-color':'#dceafb','mini-other-color':'#eceef1','mini-bg':'#f8f8f8','mini-compact':true,'mini-end':'18:00','mini-note':''};
    const fields=Object.keys(defaults);
    function apply(){
      const mode=get('mini-theme').value || 'native';
      want.miniTheme=mode;
      for(const id of ['mini-self-color','mini-other-color','mini-bg']) get(id).disabled=mode!=='custom';
      const font=Math.max(11,Math.min(20,Number(get('mini-font').value)||13))+'px';
      const css=`:root{--mini-font:${font};--mini-self:${get('mini-self-color').value};--mini-other:${get('mini-other-color').value};--mini-bg:${get('mini-bg').value}}`;
      if(vars.textContent!==css)vars.textContent=css;
      want.miniCompact=get('mini-compact').checked?'true':'';
      sync();
      if(refreshSelf())schedule();
      refreshExtras();
    }
    function save(){const values={};for(const id of fields){const e=get(id);values[id]=e.type==='checkbox'?e.checked:e.value;}chrome.storage.local.set({miniPrefs:values});apply();}
    chrome.storage.local.get('miniPrefs', result=>{for(const id of fields){const e=get(id),v=result.miniPrefs?.[id]??defaults[id];if(e.type==='checkbox')e.checked=v;else e.value=v;}apply();ready=true;fullScan=true;update();});
    for(const id of fields)get(id).addEventListener('change',save);
    chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local'||!changes.miniPrefs)return;for(const id of fields){const e=get(id),v=changes.miniPrefs.newValue?.[id]??defaults[id];if(e.type==='checkbox')e.checked=v;else if(e!==document.activeElement)e.value=v;}apply();});
    get('mini-reset').onclick=()=>{for(const id of fields.filter(x=>x!=='mini-note'&&x!=='mini-end'&&x!=='mini-self-name')){const e=get(id);if(e.type==='checkbox')e.checked=defaults[id];else e.value=defaults[id];}save();};
    get('mini-open').onclick=()=>chrome.runtime.sendMessage({type:'mini-popup',url:location.href});
    for(const [btn,panel,other] of [['mini-dash-btn','mini-dashboard','mini-settings'],['mini-settings-btn','mini-settings','mini-dashboard']])get(btn).onclick=()=>{get(panel).hidden=!get(panel).hidden;get(other).hidden=true;};
    for(const code of ['0050','0056','00878','00919']){const a=document.createElement('a');a.href='https://tw.stock.yahoo.com/quote/'+code+'.TW';a.target='_blank';a.rel='noopener noreferrer';a.textContent=code;get('mini-etfs').append(a);}
  }
  function refreshExtras(){
    const get=id=>document.getElementById(id);if(!get('mini-tools'))return;
    const nick=get('mini-nick').value.trim();
    const title=document.querySelector('[class*="chat_"] [class*="title_"] [class*="title_"]') || document.querySelector('[class*="chat_"] [class*="title_"] [class*="name_"]');
    for(const e of document.querySelectorAll('[data-mini-nick]'))if(e!==title||!nick||!enabled)delete e.dataset.miniNick;
    if(title&&nick&&enabled&&/^\/channels\/@me\/\d+/.test(location.pathname)&&title.dataset.miniNick!==nick)title.dataset.miniNick=nick;
    const unread=document.querySelector('[class*="chat_"] :is([class*="newMessagesBar_"],[class*="unreadPill_"])');
    get('mini-unread').hidden=!unread;
    const now=new Date(),end=new Date(now),parts=get('mini-end').value.split(':').map(Number);end.setHours(parts[0]||0,parts[1]||0,0,0);const mins=Math.max(0,Math.ceil((end-now)/60000));
    const text=mins?`距離下班 ${Math.floor(mins/60)} 小時 ${mins%60} 分鐘`:'已達設定下班時間';if(get('mini-clock').textContent!==text)get('mini-clock').textContent=text;
  }
})();
