import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFeed,processItems,sendZalo,facebookItems,processFacebook,FACEBOOK_PAGE_ID,parseIeltsFeed,processIelts,IELTS_SITE} from './notifier.mjs';
const url='https://phuongbui081000-glitch.github.io/emca-meca/bai-viet/bai-moi/';
const item={id:'new',title:'Bài mới',url};
function memory(initial={initialized:false,events:{}}){let data=structuredClone(initial);return {load:async()=>structuredClone(data),save:async state=>{data=structuredClone(state);},snapshot:()=>data};}
test('first successful feed becomes baseline without sending old articles',async()=>{const store=memory();let calls=0;assert.deepEqual(await processItems([item],store,async()=>{calls++;}),{baseline:1,sent:0});assert.equal(calls,0);});

test('IELTS starts its own baseline without replaying history or changing web/Facebook entries',async()=>{const store=memory({initialized:true,facebookInitialized:true,events:{web:{status:'sent'},'facebook:old':{status:'sent'}}});let sends=0;const old={id:'ielts:old',title:'Old public lesson',url:IELTS_SITE+'updates/?id=old'},fresh={id:'ielts:new',title:'New public lesson',url:IELTS_SITE+'updates/?id=new'};const send=async()=>{sends++;return {message_id:'test-only'}};assert.deepEqual(await processIelts([old],store,send),{baseline:1,sent:0});await processIelts([fresh,old],store,send);await processIelts([fresh,old],store,send);assert.equal(sends,1);assert.equal(store.snapshot().events.web.status,'sent');assert.equal(store.snapshot().events['facebook:old'].status,'sent');assert.equal(store.snapshot().events['ielts:old'].status,'baseline')});
test('IELTS parser accepts only the public updates path and rejects learner APIs or another origin',()=>{const rss=link=>`<rss><channel><item><title>Public lesson</title><link>${link}</link></item></channel></rss>`;const parsed=parseIeltsFeed(rss(IELTS_SITE+'updates/?id=lesson-1'));assert(parsed[0].id.startsWith('ielts:'));assert.throws(()=>parseIeltsFeed(rss(IELTS_SITE+'api/room/state')));assert.throws(()=>parseIeltsFeed(rss(IELTS_SITE+'updates/?id=ok&amp;token=private')));assert.throws(()=>parseIeltsFeed(rss('https://other.example/updates/?id=lesson-1')))});
test('new article sends once and persists confirmed receipt',async()=>{const store=memory({initialized:true,events:{}});let calls=0;const send=async()=>{calls++;return {message_id:'receipt'};};await processItems([item],store,send);await processItems([item],store,send);assert.equal(calls,1);assert.equal(store.snapshot().events.new.status,'sent');});
test('claim must persist before sending; state write failure sends nothing',async()=>{let calls=0;await assert.rejects(processItems([item],{load:async()=>({initialized:true,events:{}}),save:async()=>{throw new Error('write failed');}},async()=>{calls++;}));assert.equal(calls,0);});
test('uncertain send is held for review instead of automatic duplicate',async()=>{const store=memory({initialized:true,events:{}});let calls=0;const send=async()=>{calls++;throw new Error('connection reset after delivery');};await assert.rejects(processItems([item],store,send));await assert.rejects(processItems([item],store,send));assert.equal(calls,1);assert.equal(store.snapshot().events.new.status,'unknown');});
test('crash after successful send but before receipt persistence cannot resend',async()=>{let data={initialized:true,events:{}};let writes=0,calls=0;const store={load:async()=>structuredClone(data),save:async s=>{if(++writes===2)throw new Error('store unavailable');data=structuredClone(s);}};await assert.rejects(processItems([item],store,async()=>{calls++;return {message_id:'receipt'};}));await assert.rejects(processItems([item],store,async()=>{calls++;}));assert.equal(calls,1);});
test('parse RSS entities, reject foreign links, duplicate items and DTD',()=>{const rss=`<rss><channel><item><title>Cá &amp; cà</title><link>${url}</link></item></channel></rss>`;assert.equal(parseFeed(rss)[0].title,'Cá & cà');assert.throws(()=>parseFeed(rss.replace(url,'https://example.com/')));assert.throws(()=>parseFeed(rss.replace('</channel>',`<item><title>x</title><link>${url}</link></item></channel>`)));assert.throws(()=>parseFeed('<!DOCTYPE rss><rss/>'));});
test('transport failures never include secret-bearing URL',async()=>{const token='test-secret';let captured;try{await sendZalo('Test',token,'zgr-test',async()=>{throw new Error('https://example/'+token);});}catch(e){captured=e;}assert.ok(captured);assert.equal(captured.message.includes(token),false);});
test('connection test is clearly labeled and also sent at most once',async()=>{const store=memory({initialized:true,events:{}});const calls=[];const testItem={id:'connection-test-v1',url,message:'Thông báo thử, chưa có bài mới'};const send=async text=>{calls.push(text);return {message_id:'test'};};await processItems([testItem],store,send);await processItems([testItem],store,send);assert.deepEqual(calls,['Thông báo thử, chưa có bài mới']);});
test('Facebook baseline preserves web ledger and sends only subsequent posts once',async()=>{
  const store=memory({initialized:true,events:{web:{status:'sent'}}});let calls=0;
  const old={id:'facebook:old',url:'https://www.facebook.com/old'},fresh={id:'facebook:new',url:'https://www.facebook.com/new',message:'Page mới'};
  const send=async()=>{calls++;return {message_id:'fb-receipt'};};
  assert.deepEqual(await processFacebook([old],store,send),{baseline:1,sent:0});
  await processFacebook([fresh,old],store,send);await processFacebook([fresh,old],store,send);
  assert.equal(calls,1);assert.equal(store.snapshot().events.web.status,'sent');
});
test('Facebook validates identity, rebuilds pagination and carries token only in header',async()=>{
  const calls=[];const post=n=>({id:FACEBOOK_PAGE_ID+'_'+n,message:'Bài '+n,permalink_url:'https://www.facebook.com/posts/'+n});
  const results=[{id:FACEBOOK_PAGE_ID},{data:[post(2)],paging:{next:'https://untrusted.invalid/?access_token=secret',cursors:{after:'cursor'}}},{data:[post(1)]}];
  const items=await facebookItems('secret',async(url,options)=>{calls.push({url:String(url),options});return {ok:true,json:async()=>results.shift()};});
  assert.equal(items.length,2);assert.ok(calls[2].url.includes('after=cursor'));assert.ok(calls.every(c=>new URL(c.url).hostname==='graph.facebook.com'&&!c.url.includes('secret')&&c.options.headers.Authorization==='Bearer secret'));
});
test('Facebook rejects wrong Page, foreign permalink and secret-bearing transport errors',async()=>{
  await assert.rejects(facebookItems('secret',async()=>({ok:true,json:async()=>({id:'wrong'})})),/Unexpected Facebook Page/);
  let calls=0;await assert.rejects(facebookItems('secret',async()=>({ok:true,json:async()=>++calls===1?{id:FACEBOOK_PAGE_ID}:{data:[{id:FACEBOOK_PAGE_ID+'_1',permalink_url:'https://example.com/'}]}})),/Unexpected Facebook post/);
  await assert.rejects(facebookItems('secret',async()=>{throw new Error('secret');}),e=>!e.message.includes('secret'));
});

