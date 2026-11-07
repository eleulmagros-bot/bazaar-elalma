const grid=document.getElementById('products'), search=document.getElementById('search');
const count=document.getElementById('count'), empty=document.getElementById('empty');
let allProducts=[], wa='213773760420';
document.getElementById('year').textContent=new Date().getFullYear();
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function render(){
 const q=search.value.trim().toLowerCase();
 const list=allProducts.filter(p=>(p.title+' '+p.description).toLowerCase().includes(q));
 count.textContent=`${list.length} منتج`;
 empty.hidden=list.length!==0;
 grid.innerHTML=list.map(p=>{
  const message=encodeURIComponent(`السلام عليكم، أريد الاستفسار عن المنتج: ${p.title}${p.price?' - السعر: '+p.price+' دج':''}`);
  return `<article class="card"><div class="photo">${p.image?`<img loading="lazy" src="${esc(p.image)}" alt="${esc(p.title)}">`:'<span class="no-photo">لا توجد صورة</span>'}</div><div class="details"><h3>${esc(p.title)}</h3><div class="desc">${esc(p.description||'')}</div><div class="price ${p.price?'':'missing'}">${p.price?esc(p.price)+' دج':'السعر عند الاستفسار'}</div><a class="order" href="https://wa.me/${wa}?text=${message}" target="_blank" rel="noopener">اطلب عبر واتساب</a></div></article>`;
 }).join('');
}
async function init(){
 try{
  const [p,c]=await Promise.all([fetch('/api/products'),fetch('/api/config')]);
  allProducts=await p.json(); const cfg=await c.json(); wa=cfg.whatsappNumber||wa; render();
 }catch(e){count.textContent='تعذر تحميل المنتجات';}
}
search.addEventListener('input',render);init();
