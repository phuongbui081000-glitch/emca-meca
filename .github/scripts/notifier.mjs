import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const FEED='https://phuongbui081000-glitch.github.io/emca-meca/feed.xml';
const SITE='https://phuongbui081000-glitch.github.io/emca-meca/';
export const IELTS_SITE='https://emca-ielts.emca-ielts.workers.dev/';
export const IELTS_FEED=IELTS_SITE+'feed.xml';
const STATE_BRANCH='zalo-notifier-state';
const STATE_PATH='.github/zalo-notifier-state.json';
const hash=s=>createHash('sha256').update(s).digest('hex');
const decode=s=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi,(m,n,e)=>n?String.fromCodePoint(parseInt(n[0].toLowerCase()==='x'?n.slice(1):n,n[0].toLowerCase()==='x'?16:10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[e.toLowerCase()]));
export function parseFeed(xml,{site=SITE,prefix=SITE+'bai-viet/',idPrefix=''}={}){
  if(!/<rss\b/i.test(xml)||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Invalid RSS');
  const items=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m=>{
    const field=tag=>decode(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,'i').exec(m[1])?.[1]||'').trim();
    const title=field('title'),url=field('link');
    if(!title||title.length>400||!url.startsWith(prefix)||new URL(url).origin!==new URL(site).origin)throw new Error('Invalid feed item');
    return {id:idPrefix+hash(url),title,url};
  });
  if(new Set(items.map(i=>i.id)).size!==items.length)throw new Error('Duplicate feed URL');
  return items;
}
export function parseIeltsFeed(xml){return parseFeed(xml,{site:IELTS_SITE,prefix:IELTS_SITE+'updates/?id=',idPrefix:'ielts:'}).map(item=>{const url=new URL(item.url);if(url.pathname!=='/updates/'||url.username||url.password||url.hash||[...url.searchParams.keys()].join(',')!=='id'||!/^[-a-z0-9]{1,100}$/.test(url.searchParams.get('id')))throw new Error('Invalid public IELTS update');return {...item,message:`emca ielts có bài học, học liệu hoặc cập nhật mới\n${item.title}\nhọc đê\n${item.url}`}})}
export async function readIeltsFeed(fetcher=fetch){const r=await fetcher(IELTS_FEED,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('IELTS public feed unavailable');const xml=await r.text();if(xml.length>2000000)throw new Error('IELTS public feed too large');return parseIeltsFeed(xml)}
export async function processIelts(items,store,send){const state=await store.load();if(!state.initialized)throw new Error('Initialize web first');if(!state.ieltsInitialized){for(const item of items)if(!state.events[item.id])state.events[item.id]={status:'baseline',url:item.url};state.ieltsInitialized=true;await store.save(state);return {baseline:items.length,sent:0}}return processItems(items,store,send)}
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
    try{receipt=await send(item.message||`Cá có bài mới trên web nè.\n${item.title}\nĐọc bài tại đây:\n${item.url}`);}
    catch{state.events[item.id].status='unknown';await store.save(state);throw new Error('Delivery uncertain; no automatic retry');}
    state.events[item.id]={status:'sent',url:item.url,message_id:receipt.message_id,sentAt:new Date().toISOString()};
    await store.save(state);sent++;
  }
  return {baseline:0,sent};
}
export const FACEBOOK_PAGE_ID='1314701205068419';
export async function facebookItems(token,fetcher=fetch){
  if(!token)throw new Error('Facebook token missing');
  const read=async(path,params)=>{
    const url=new URL(`https://graph.facebook.com/v26.0/${path}`);
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
    let response,data;
    try{response=await fetcher(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});data=await response.json();}catch{throw new Error('Facebook connection failed');}
    if(!response.ok||data.error)throw new Error('Facebook access failed; check Page token');
    return data;
  };
  const identity=await read('me',{fields:'id,name'});
  if(identity.id!==FACEBOOK_PAGE_ID)throw new Error('Unexpected Facebook Page');
  const items=[];let after;
  for(let page=0;page<20;page++){
    const data=await read(`${FACEBOOK_PAGE_ID}/published_posts`,{fields:'id,message,created_time,permalink_url',limit:'100',...(after?{after}:{})});
    if(!Array.isArray(data.data))throw new Error('Invalid Facebook posts');
    for(const post of data.data){
      let url;try{url=new URL(post.permalink_url);}catch{throw new Error('Missing Facebook permalink');}
      if(!post.id?.startsWith(FACEBOOK_PAGE_ID+'_')||url.protocol!=='https:'||!['facebook.com','www.facebook.com','m.facebook.com'].includes(url.hostname))throw new Error('Unexpected Facebook post');
      const title=(post.message||'Bài đăng mới trên Page Emca meca').split(/\r?\n/).find(x=>x.trim())?.trim().slice(0,300)||'Bài đăng mới trên Page Emca meca';
      items.push({id:`facebook:${post.id}`,title,url:url.href,message:`Cá có bài mới trên Page nè.\n${title}\nXem bài tại đây:\n${url.href}`});
    }
    if(!data.paging?.next){if(new Set(items.map(x=>x.id)).size!==items.length)throw new Error('Duplicate Facebook posts');return items;}
    const cursor=data.paging?.cursors?.after;
    if(!cursor||cursor===after)throw new Error('Invalid Facebook pagination');
    after=cursor;
  }
  throw new Error('Facebook history exceeds safe pagination limit');
}
export async function processFacebook(items,store,send){
  const state=await store.load();
  if(!state.initialized)throw new Error('Initialize web first');
  if(!state.facebookInitialized){
    for(const item of items)if(!state.events[item.id])state.events[item.id]={status:'baseline',url:item.url};
    state.facebookInitialized=true;await store.save(state);return {baseline:items.length,sent:0};
  }
  return processItems(items,store,send);
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
  if(process.argv.includes('--dry-run')){const ielts=await readIeltsFeed();console.log(JSON.stringify({feedItems:items.length,ieltsItems:ielts.length,mode:'read-only',sent:0}));return;}
  const {GITHUB_REPOSITORY,GITHUB_TOKEN,ZALO_BOT_TOKEN,ZALO_GROUP_ID}=process.env;
  if(!GITHUB_TOKEN||!ZALO_BOT_TOKEN||!ZALO_GROUP_ID)throw new Error('Required secrets missing');
  const store=githubStore(GITHUB_REPOSITORY,GITHUB_TOKEN);
  const send=text=>sendZalo(text,ZALO_BOT_TOKEN,ZALO_GROUP_ID);
  if(process.env.ZALO_TEST_CONNECTION==='true'){
    const state=await store.load();if(!state.initialized)throw new Error('Initialize web baseline before connection test');
    const testItem={id:'connection-test-v1',url:SITE,message:`Thông báo thử bot emca meca.\nBot đã gửi tin này từ GitHub, không phụ thuộc máy của Cá đang mở.\nPhần theo dõi bài web mới đã được bật; Facebook chưa kết nối.\n${SITE}`};
    console.log(JSON.stringify({mode:'connection-test',...await processItems([testItem],store,send)}));return;
  }
  console.log(JSON.stringify({source:'web',...await processItems(items,store,send)}));
  if(process.env.FACEBOOK_PAGE_TOKEN){
    const expires=Number(process.env.FACEBOOK_TOKEN_EXPIRES_AT||0);
    if(expires&&Date.now()/1000>=expires)throw new Error('Facebook token expired');
    if(expires&&expires-Date.now()/1000<14*86400)console.log('::warning::Facebook Page token needs renewal before 2026-12-23.');
    const posts=await facebookItems(process.env.FACEBOOK_PAGE_TOKEN);
    console.log(JSON.stringify({source:'facebook',...await processFacebook(posts,store,send)}));
    if(process.env.FACEBOOK_TEST_CONNECTION==='true'){
      if(!posts.length)throw new Error('No published Facebook post for connection test');
      const latest=posts[0];
      console.log(JSON.stringify({mode:'facebook-connection-test',...await processItems([{...latest,id:'facebook-connection-test-v1',message:`Thông báo thử kết nối Page Emca meca.\nBot đã đọc được bài Page và đường link thật. Đây là tin thử, không phải thông báo bài mới.\n${latest.title}\n${latest.url}`}],store,send)}));
    }
  }
  console.log(JSON.stringify({source:'ielts-public',...await processIelts(await readIeltsFeed(),store,send)}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){main().catch(()=>{console.error('Notification run failed. No credentials or raw request errors printed. Review delivery state before retry.');process.exitCode=1;});}

