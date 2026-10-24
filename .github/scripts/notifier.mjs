import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const FEED='https://phuongbui081000-glitch.github.io/emca-meca/feed.xml';
const SITE='https://phuongbui081000-glitch.github.io/emca-meca/';
const STATE_BRANCH='zalo-notifier-state';
const STATE_PATH='.github/zalo-notifier-state.json';
const hash=s=>createHash('sha256').update(s).digest('hex');
const decode=s=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi,(m,n,e)=>n?String.fromCodePoint(parseInt(n[0].toLowerCase()==='x'?n.slice(1):n,n[0].toLowerCase()==='x'?16:10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[e.toLowerCase()]));
export function parseFeed(xml){
  if(!/<rss\b/i.test(xml)||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Invalid RSS');
  const items=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m=>{
    const field=tag=>decode(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,'i').exec(m[1])?.[1]||'').trim();
    const title=field('title'),url=field('link');
    if(!title||title.length>400||!url.startsWith(SITE+'bai-viet/')||new URL(url).origin!==new URL(SITE).origin)throw new Error('Invalid feed item');
    return {id:hash(url),title,url};
  });
  if(new Set(items.map(i=>i.id)).size!==items.length)throw new Error('Duplicate feed URL');
  return items;
}
export async function processItems(items,store,send){
  const state=await store.load();
  if(!state.initialized){
    state.initialized=true;state.events=Object.fromEntries(items.map(i=>[i.id,{status:'baseline',url:i.url}]));
    await store.save(state);return {baseline:items.length,sent:0};
  }
  if(Object.values(state.events).some(v=>v.status==='sending'||v.status==='unknown'))throw new Error('Uncertain earlier delivery; review before retry');
  let sent=0;
  for(const item of [...items].reverse()){
    if(state.events[item.id])continue;
    state.events[item.id]={status:'sending',url:item.url};
    await store.save(state); // Persist the claim before the external side effect.
    let receipt;
    try{receipt=await send(`Cá có bài mới trên web nè.\n${item.title}\nĐọc bài tại đây:\n${item.url}`);}
    catch{state.events[item.id].status='unknown';await store.save(state);throw new Error('Delivery uncertain; no automatic retry');}
    state.events[item.id]={status:'sent',url:item.url,message_id:receipt.message_id,sentAt:new Date().toISOString()};
    await store.save(state);sent++;
  }
  return {baseline:0,sent};
}
export function githubStore(repo,token,fetcher=fetch){
  if(repo!=='phuongbui081000-glitch/emca-meca')throw new Error('Unexpected repository');
  let sha;
  const api=async(path,method='GET',body)=>{
    let res;try{res=await fetcher(`https://api.github.com/repos/${repo}/${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});}catch{throw new Error('GitHub connection failed');}
    if(res.status===404)return null;
    if(!res.ok)throw new Error(`GitHub API status ${res.status}`);
    return res.json();
  };
  return {
    async load(){
      let ref=await api(`git/ref/heads/${STATE_BRANCH}`);
      if(!ref){const main=await api('git/ref/heads/main');if(!main?.object?.sha)throw new Error('Missing main');ref=await api('git/refs','POST',{ref:`refs/heads/${STATE_BRANCH}`,sha:main.object.sha});if(!ref)throw new Error('Cannot create state branch');}
      const file=await api(`contents/${STATE_PATH}?ref=${STATE_BRANCH}`);
      if(!file)return {initialized:false,events:{}};
      sha=file.sha;const state=JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));
      if(typeof state.initialized!=='boolean'||!state.events||Array.isArray(state.events))throw new Error('Invalid state');
      return state;
    },
    async save(state){
      const saved=await api(`contents/${STATE_PATH}`,'PUT',{branch:STATE_BRANCH,message:'Update Zalo notification delivery state',content:Buffer.from(JSON.stringify(state,null,2)+'\n').toString('base64'),...(sha?{sha}:{})});
      if(!saved?.content?.sha)throw new Error('State not persisted');sha=saved.content.sha;
    }
  };
}
export async function sendZalo(text,token,chatId,fetcher=fetch){
  if(!token||!chatId?.startsWith('zgr-')||text.length>2000)throw new Error('Invalid bot configuration');
  let res;try{res=await fetcher(`https://bot-api.zaloplatforms.com/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text}),signal:AbortSignal.timeout(20000)});}catch{throw new Error('Zalo connection failed');}
  if(!res.ok)throw new Error(`Zalo HTTP status ${res.status}`);
  let payload;try{payload=await res.json();}catch{throw new Error('Invalid Zalo response');}
  if(!payload.ok||!payload.result?.message_id)throw new Error('Zalo did not confirm delivery');
  return {message_id:payload.result.message_id};
}
async function main(){
  const response=await fetch(FEED,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('RSS unavailable');
  const xml=await response.text();if(xml.length>2000000)throw new Error('RSS too large');
  const items=parseFeed(xml);
  if(process.argv.includes('--dry-run')){console.log(JSON.stringify({feedItems:items.length,mode:'read-only',sent:0}));return;}
  const {GITHUB_REPOSITORY,GITHUB_TOKEN,ZALO_BOT_TOKEN,ZALO_GROUP_ID}=process.env;
  if(!GITHUB_TOKEN||!ZALO_BOT_TOKEN||!ZALO_GROUP_ID)throw new Error('Required secrets missing');
  console.log(JSON.stringify(await processItems(items,githubStore(GITHUB_REPOSITORY,GITHUB_TOKEN),text=>sendZalo(text,ZALO_BOT_TOKEN,ZALO_GROUP_ID))));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){main().catch(()=>{console.error('Notification run failed. No credentials or raw request errors printed. Review delivery state before retry.');process.exitCode=1;});}
