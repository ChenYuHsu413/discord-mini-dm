const valid = url => typeof url === 'string' && /^https:\/\/discord\.com\/channels\/@me\/\d+\/?$/.test(url);
let pending = Promise.resolve();
function launch(url) {
  pending = pending.catch(()=>{}).then(async()=>{
    const {miniLastDM,miniBounds} = await chrome.storage.local.get(['miniLastDM','miniBounds']);
    const target = valid(url) ? url : miniLastDM;
    if (!valid(target)) { await chrome.tabs.create({url:'https://discord.com/channels/@me'}); return; }
    await chrome.storage.local.set({miniLastDM:target});
    const windows = await chrome.windows.getAll({populate:true,windowTypes:['popup']});
    const existing = windows.find(w=>w.tabs?.some(t=>t.url===target));
    if(existing){await chrome.storage.session.set({miniPopup:existing.id});await chrome.windows.update(existing.id,{focused:true,...(existing.state==='minimized'?{state:'normal'}:{})});return;}
    const b=miniBounds||{};
    const options={url:target,type:'popup',width:Math.max(320,Math.min(2000,b.width||420)),height:Math.max(300,Math.min(2000,b.height||650)),focused:true};
    if(Number.isInteger(b.left)&&Number.isInteger(b.top)){options.left=b.left;options.top=b.top;}
    let w;try{w=await chrome.windows.create(options);}catch{delete options.left;delete options.top;w=await chrome.windows.create(options);}
    await chrome.storage.session.set({miniPopup:w.id});
  });
  return pending;
}
chrome.runtime.onMessage.addListener((message,sender)=>{
  if(message.type==='mini-popup'&&sender.tab&&valid(message.url)) launch(message.url).catch(console.warn);
  if(message.type==='mini-last-dm'&&sender.tab&&valid(message.url)) chrome.storage.local.set({miniLastDM:message.url});
});
chrome.action.onClicked.addListener(tab=>launch(valid(tab.url)?tab.url:undefined).catch(console.warn));
chrome.windows.onBoundsChanged.addListener(async w=>{
  const {miniPopup}=await chrome.storage.session.get('miniPopup');
  if(w.id!==miniPopup||w.state!=='normal')return;
  if([w.left,w.top,w.width,w.height].every(Number.isInteger)) await chrome.storage.local.set({miniBounds:{left:w.left,top:w.top,width:w.width,height:w.height}});
});
