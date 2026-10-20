const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLocaleLowerCase('vi');
const tools=document.querySelector('[data-blog-tools]');
if(tools){
  const cards=[...document.querySelectorAll('#story-grid .story-card')];
  const search=document.querySelector('#search'),form=document.querySelector('#tim-kiem');
  const filters=[...document.querySelectorAll('[data-filter]')],pagination=document.querySelector('.pagination');
  const count=document.querySelector('#result-count'),empty=document.querySelector('#no-results');
  const categories=new Set(filters.map(b=>b.dataset.filter));
  const pageSize=6;let currentPage=1,filter='all',timer;
  const index=new Map(cards.map(card=>[card,normalize(card.dataset.search)]));
  function stateFromURL(){const params=new URLSearchParams(location.search);search.value=(params.get('q')||'').slice(0,200);filter=categories.has(params.get('chu-de'))?params.get('chu-de'):'all';currentPage=Math.max(1,parseInt(params.get('trang'),10)||1)}
  function updateURL(){const params=new URLSearchParams();if(search.value.trim())params.set('q',search.value.trim());if(filter!=='all')params.set('chu-de',filter);if(currentPage>1)params.set('trang',String(currentPage));const query=params.toString();history.replaceState(null,'',location.pathname+(query?'?'+query:'')+location.hash)}
  function pageButton(label,value,current=false){const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.page=value;button.className='page-button';button.setAttribute('aria-label',/^\d+$/.test(label)?`Trang ${value}`:`${label}, trang ${value}`);if(current){button.setAttribute('aria-current','page')}return button}
  function render({writeURL=true,focusPage=false}={}){
    const q=normalize(search.value.trim()),terms=q.split(/\s+/).filter(Boolean);
    const matches=cards.filter(c=>(filter==='all'||c.dataset.category===filter)&&terms.every(term=>index.get(c).includes(term)));
    const pages=Math.max(1,Math.ceil(matches.length/pageSize));currentPage=Math.min(currentPage,pages);
    const shown=new Set(matches.slice((currentPage-1)*pageSize,currentPage*pageSize));cards.forEach(c=>c.hidden=!shown.has(c));
    filters.forEach(button=>{const active=button.dataset.filter===filter;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});
    count.textContent=`${matches.length} bài viết`+(matches.length>pageSize?`, trang ${currentPage} trên ${pages}`:'');
    empty.hidden=matches.length!==0;pagination.hidden=pages<=1;pagination.replaceChildren();
    if(pages>1){
      if(currentPage>1)pagination.append(pageButton('Trang trước',currentPage-1));
      for(let p=Math.max(1,currentPage-2);p<=Math.min(pages,currentPage+2);p++)pagination.append(pageButton(String(p),p,p===currentPage));
      if(currentPage<pages)pagination.append(pageButton('Trang sau',currentPage+1));
    }
    if(writeURL)updateURL();if(focusPage)pagination.querySelector('[aria-current]')?.focus();
  }
  tools.hidden=false;stateFromURL();render({writeURL:false});
  form.addEventListener('submit',event=>{event.preventDefault();clearTimeout(timer);currentPage=1;render()});
  search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{currentPage=1;render()},120)});
  filters.forEach(button=>button.addEventListener('click',()=>{clearTimeout(timer);filter=button.dataset.filter;currentPage=1;render()}));
  document.querySelector('#reset').addEventListener('click',()=>{clearTimeout(timer);search.value='';filter='all';currentPage=1;render();search.focus()});
  pagination.addEventListener('click',event=>{const button=event.target.closest('[data-page]');if(!button)return;currentPage=Number(button.dataset.page);render({focusPage:true});document.querySelector('#bai-viet').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})});
  window.addEventListener('popstate',()=>{stateFromURL();render({writeURL:false})});
  if(location.hash==='#tim-kiem')search.focus({preventScroll:true});
  document.querySelector('.search-toggle')?.addEventListener('click',event=>{event.preventDefault();document.querySelector('#bai-viet').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});search.focus({preventScroll:true})});
}
const copyButton=document.querySelector('#copy-link');
copyButton?.addEventListener('click',async()=>{
  const status=document.querySelector('#copy-status');
  const canonical=document.querySelector('link[rel="canonical"]')?.href||location.href;
  try{await navigator.clipboard.writeText(canonical);status.textContent='Đã chép liên kết.'}
  catch{status.textContent=`M có thể chép địa chỉ này: ${canonical}`}
});
