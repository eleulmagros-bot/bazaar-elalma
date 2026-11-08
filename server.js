const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const PDFDocument = require('pdfkit');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || '');
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const CHANNEL_USERNAME = (process.env.CHANNEL_USERNAME || 'eleulmashop213').replace('@','');
const DATA_DIR = path.join(__dirname, 'data');
const IMAGE_DIR = path.join(__dirname, 'public', 'images');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
fs.mkdirSync(DATA_DIR, {recursive:true}); fs.mkdirSync(IMAGE_DIR,{recursive:true});
for (const [f, initial] of [[PRODUCTS_FILE,'[]'],[ORDERS_FILE,'[]'],[SESSIONS_FILE,'{}']]) if (!fs.existsSync(f)) fs.writeFileSync(f,initial);
const read = f => { try { return JSON.parse(fs.readFileSync(f,'utf8')); } catch { return f===SESSIONS_FILE?{}:[]; } };
const write = (f,v) => fs.writeFileSync(f,JSON.stringify(v,null,2));
const products=()=>read(PRODUCTS_FILE), orders=()=>read(ORDERS_FILE), sessions=()=>read(SESSIONS_FILE);
const saveProducts=v=>write(PRODUCTS_FILE,v), saveOrders=v=>write(ORDERS_FILE,v), saveSessions=v=>write(SESSIONS_FILE,v);
function telegram(method, body) {
  if (!BOT_TOKEN) return Promise.reject(new Error('TELEGRAM_BOT_TOKEN غير مضبوط'));
  return new Promise((resolve,reject)=>{
    const req=https.request({hostname:'api.telegram.org',path:`/bot${BOT_TOKEN}/${method}`,method:'POST',headers:{'Content-Type':'application/json'}},res=>{
      let data=''; res.on('data',c=>data+=c); res.on('end',()=>{try{const p=JSON.parse(data); if(!p.ok) return reject(new Error(p.description||'Telegram API error')); resolve(p.result);}catch(e){reject(e);}});
    }); req.on('error',reject); req.write(JSON.stringify(body)); req.end();
  });
}
function send(chat_id,text,extra={}) { return telegram('sendMessage',{chat_id,text,parse_mode:'HTML',...extra}); }
function keyboard(rows){return {inline_keyboard:rows};}
function isAdmin(id){return ADMIN_ID && String(id)===ADMIN_ID;}
function money(n){return `${Number(n||0).toLocaleString('fr-FR')} دج`;}
function parsePost(post){
 const caption=(post.caption||'').trim(), lines=caption.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const title=lines[0]||'منتج جديد';
 const priceMatch=caption.match(/(?:السعر\s*[:：]?\s*)?([\d][\d\s.,]*)\s*(?:دج|د\.ج|DA|دنانير)/i);
 const price=priceMatch?Number(priceMatch[1].replace(/[\s,.]/g,'')):0;
 const photo=post.photo?.length?post.photo[post.photo.length-1].file_id:null;
 return {title,price,description:lines.slice(1).join('\n')||caption,photoFileId:photo,telegramMessageId:post.message_id};
}
async function saveTelegramPhoto(fileId,id){
 const info=await telegram('getFile',{file_id:fileId}); const url=`https://api.telegram.org/file/bot${BOT_TOKEN}/${info.file_path}`; const target=path.join(IMAGE_DIR,`${id}.jpg`);
 await new Promise((resolve,reject)=>https.get(url,r=>{if(r.statusCode!==200)return reject(new Error('image download failed'));const out=fs.createWriteStream(target);r.pipe(out);out.on('finish',()=>out.close(resolve));}).on('error',reject));
 return `/images/${id}.jpg`;
}
function home(id){const rows=[[{text:'🛍️ تصفح المنتجات',callback_data:'shop'}],[{text:'🛒 سلة المشتريات',callback_data:'cart'}],[{text:'📦 طلباتي',callback_data:'myorders'}]]; if(isAdmin(id)) rows.push([{text:'⚙️ إدارة المنتجات',callback_data:'admin'},{text:'📋 جميع الطلبيات',callback_data:'orders'}]); return keyboard(rows);}
async function showProducts(chatId,page=0){const list=products().filter(p=>p.active!==false);if(!list.length)return send(chatId,'لا توجد منتجات حالياً.');const p=list.slice(page*8,page*8+8);const rows=p.map(x=>[{text:`${x.title} — ${money(x.price)} | أدنى كمية: ${x.minQty||1}`,callback_data:`product:${x.id}`}]);if(page>0)rows.push([{text:'⬅️ السابق',callback_data:`page:${page-1}`}]);if((page+1)*8<list.length)rows.push([{text:'التالي ➡️',callback_data:`page:${page+1}`}]);rows.push([{text:'🏠 القائمة الرئيسية',callback_data:'home'}]);return send(chatId,'🛍️ <b>منتجات الجملة</b>\nاختر المنتج لعرض التفاصيل:',{reply_markup:keyboard(rows)});}
async function showProduct(chatId,id){const p=products().find(x=>x.id===id);if(!p)return send(chatId,'المنتج غير موجود.');const min=Math.max(1,Number(p.minQty)||1);const text=`<b>${p.title}</b>\n${p.description||''}\n\nسعر القطعة: <b>${money(p.price)}</b>\nأقل كمية: <b>${min}</b>\n\nلإضافة المنتج أرسل الكمية المطلوبة بعد الضغط على الزر.`;return send(chatId,text,{reply_markup:keyboard([[{text:'➕ إضافة إلى السلة',callback_data:`add:${id}`}],[{text:'🔙 رجوع للمنتجات',callback_data:'shop'}]])});}
function cartText(cart){let total=0;const lines=cart.map(i=>{const p=products().find(x=>x.id===i.id);if(!p)return '';const sum=p.price*i.qty;total+=sum;return `• ${p.title} × ${i.qty} = ${money(sum)}`;}).filter(Boolean);return {text:lines.join('\n')||'السلة فارغة.',total};}
async function showCart(chatId,id){const s=sessions()[id]||{},cart=s.cart||[];const c=cartText(cart);const rows=[];if(cart.length)rows.push([{text:'✅ إتمام الطلب',callback_data:'checkout'},{text:'🗑️ تفريغ السلة',callback_data:'clearcart'}]);rows.push([{text:'🛍️ مواصلة التسوق',callback_data:'shop'},{text:'🏠 الرئيسية',callback_data:'home'}]);return send(chatId,`${c.text}\n\n<b>المجموع: ${money(c.total)}</b>`,{reply_markup:keyboard(rows)});}
async function ask(chatId,id,field,text){const ss=sessions();ss[id]={...(ss[id]||{}),step:field};saveSessions(ss);return send(chatId,text);}
async function createInvoice(order){
 const file=path.join(DATA_DIR,`invoice-${order.id}.pdf`);
 await new Promise((resolve,reject)=>{const doc=new PDFDocument({margin:45});const out=fs.createWriteStream(file);doc.pipe(out);doc.font('Helvetica');doc.fontSize(20).text('BAZAAR ELALMA - WHOLESALE', {align:'center'});doc.moveDown();doc.fontSize(14).text(`INVOICE: ${order.id}`);doc.text(`Date: ${new Date(order.createdAt).toLocaleString('en-GB')}`);doc.moveDown();doc.fontSize(12).text(`Customer: ${order.customer.name}`);doc.text(`Phone: ${order.customer.phone}`);doc.text(`Wilaya: ${order.customer.wilaya}`);doc.text(`Municipality: ${order.customer.city}`);doc.text(`Address: ${order.customer.address}`);doc.moveDown().text('Products');let total=0;for(const item of order.items){const line=item.title;const sum=item.price*item.qty;total+=sum;doc.text(`${line} | ${item.qty} x ${item.price} DZD = ${sum} DZD`);}doc.moveDown().fontSize(15).text(`TOTAL: ${total} DZD`);doc.end();out.on('finish',resolve);out.on('error',reject);});return file;
}
function sendDocument(chatId,file,caption){return new Promise((resolve,reject)=>{const boundary='----tg'+Date.now();const fileName=path.basename(file);const fileData=fs.readFileSync(file);const fields={chat_id:String(chatId),caption};let body='';for(const [k,v] of Object.entries(fields))body+=`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;const head=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`);const tail=Buffer.from(`\r\n--${boundary}--\r\n`);const payload=Buffer.concat([Buffer.from(body),head,fileData,tail]);const req=https.request({hostname:'api.telegram.org',path:`/bot${BOT_TOKEN}/sendDocument`,method:'POST',headers:{'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':payload.length}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{const j=JSON.parse(d);if(!j.ok)return reject(new Error(j.description));resolve(j.result);}catch(e){reject(e);}});});req.on('error',reject);req.write(payload);req.end();});}
async function handleText(msg){const id=String(msg.from.id),chat=msg.chat.id,text=(msg.text||'').trim();if(text==='/start'||text==='/menu')return send(chat,'مرحباً بك في <b>بزناسة العلمة للجملة</b> 🛍️\nاختر الخدمة:',{reply_markup:home(id)});
 const ss=sessions(),s=ss[id]||{};
 if(s.step==='quantity'){const qty=Number(text),p=products().find(x=>x.id===s.productId);if(!p||!Number.isInteger(qty)||qty<(p.minQty||1)||qty>100000)return send(chat,`أدخل كمية صحيحة لا تقل عن ${p?.minQty||1}.`);s.cart=s.cart||[];const old=s.cart.find(x=>x.id===p.id);if(old)old.qty+=qty;else s.cart.push({id:p.id,qty});delete s.step;delete s.productId;ss[id]=s;saveSessions(ss);return send(chat,'✅ تمت إضافة المنتج إلى السلة.',{reply_markup:home(id)});}
 if(s.step==='name'||s.step==='phone'||s.step==='wilaya'||s.step==='city'||s.step==='address'){const labels={name:'الاسم واللقب',phone:'رقم الهاتف',wilaya:'الولاية',city:'البلدية',address:'العنوان'};s.customer=s.customer||{};s.customer[s.step]=text;const next={name:'phone',phone:'wilaya',wilaya:'city',city:'address'}[s.step];if(next){s.step=next;ss[id]=s;saveSessions(ss);return send(chat,`أدخل ${labels[next]}:`);}delete s.step;ss[id]=s;saveSessions(ss);const c=cartText(s.cart||[]);return send(chat,`راجع معلوماتك:\nالاسم: ${s.customer.name}\nالهاتف: ${s.customer.phone}\nالولاية: ${s.customer.wilaya}\nالبلدية: ${s.customer.city}\nالعنوان: ${s.customer.address}\n\n${c.text}\nالمجموع: ${money(c.total)}`,{reply_markup:keyboard([[{text:'✅ تأكيد الطلبية',callback_data:'confirm'},{text:'❌ إلغاء',callback_data:'home'}]])});}
 if(isAdmin(id)&&s.step==='setprice'){const value=Number(text);if(!Number.isFinite(value)||value<=0)return send(chat,'أدخل سعراً صحيحاً بالدينار.');const list=products(),p=list.find(x=>x.id===s.productId);if(!p)return send(chat,'المنتج غير موجود.');p.price=value;saveProducts(list);delete s.step;delete s.productId;ss[id]=s;saveSessions(ss);return send(chat,'تم تحديث السعر ✅',{reply_markup:home(id)});}
 if(isAdmin(id)&&s.step==='setmin'){const value=Number(text);if(!Number.isInteger(value)||value<1)return send(chat,'أدخل كمية صحيحة أكبر من صفر.');const list=products(),p=list.find(x=>x.id===s.productId);if(!p)return send(chat,'المنتج غير موجود.');p.minQty=value;saveProducts(list);delete s.step;delete s.productId;ss[id]=s;saveSessions(ss);return send(chat,'تم تحديث أقل كمية ✅',{reply_markup:home(id)});}
 return send(chat,'استعمل الأزرار الموجودة في القائمة للمتابعة.',{reply_markup:home(id)});
}
async function callback(q){const id=String(q.from.id),chat=q.message.chat.id,data=q.data||'';await telegram('answerCallbackQuery',{callback_query_id:q.id});
 if(data==='home')return send(chat,'القائمة الرئيسية:',{reply_markup:home(id)});
 if(data==='shop')return showProducts(chat,0);if(data.startsWith('page:'))return showProducts(chat,Number(data.split(':')[1]));
 if(data.startsWith('product:'))return showProduct(chat,data.slice(8));
 if(data.startsWith('add:')){const ss=sessions();ss[id]={...(ss[id]||{}),step:'quantity',productId:data.slice(4)};saveSessions(ss);const p=products().find(x=>x.id===data.slice(4));return send(chat,`أرسل الكمية المطلوبة من ${p?.title||'المنتج'} (الحد الأدنى ${p?.minQty||1}).`);}
 if(data==='cart')return showCart(chat,id);if(data==='clearcart'){const ss=sessions();ss[id]={...(ss[id]||{}),cart:[]};saveSessions(ss);return showCart(chat,id);}
 if(data==='checkout'){const s=sessions()[id]||{};if(!s.cart?.length)return send(chat,'السلة فارغة.');return ask(chat,id,'name','أدخل الاسم واللقب:');}
 if(data==='confirm'){const ss=sessions(),s=ss[id]||{};if(!s.cart?.length||!s.customer)return send(chat,'تعذر تأكيد الطلب. أعد المحاولة.');const items=s.cart.map(i=>{const p=products().find(x=>x.id===i.id);return p?{id:p.id,title:p.title,price:Number(p.price),qty:i.qty}:null;}).filter(Boolean);if(!items.length)return send(chat,'المنتجات لم تعد متوفرة.');const order={id:`BA-${Date.now()}`,userId:id,customer:s.customer,items,createdAt:new Date().toISOString(),status:'جديد'};const all=orders();all.unshift(order);saveOrders(all);s.cart=[];s.customer=null;ss[id]=s;saveSessions(ss);const total=items.reduce((a,x)=>a+x.price*x.qty,0);await send(chat,`✅ تم تسجيل طلبك بنجاح.\nرقم الطلب: <b>${order.id}</b>\nالمجموع: <b>${money(total)}</b>\nسيتم التواصل معك لتأكيد التوصيل.`);try{const pdf=await createInvoice(order);await sendDocument(chat,pdf,`فاتورة الطلب ${order.id}`);if(ADMIN_ID)await send(ADMIN_ID,`🆕 <b>طلبية جديدة</b>\nرقم: ${order.id}\nالزبون: ${order.customer.name}\nالهاتف: ${order.customer.phone}\nالمجموع: ${money(total)}`,{reply_markup:keyboard([[{text:'✅ قبول',callback_data:`accept:${order.id}`},{text:'❌ رفض',callback_data:`reject:${order.id}`} ]])});}catch(e){console.error('Invoice/notification error',e.message);}return;}
 if(data==='admin'&&isAdmin(id)){const list=products();if(!list.length)return send(chat,'لا توجد منتجات بعد. انشر منتجات في القناة أولاً.');return send(chat,'اختر منتجاً لإدارة سعره والكمية الدنيا:',{reply_markup:keyboard(list.slice(0,40).map(p=>[{text:p.title,callback_data:`manage:${p.id}`}]))});}
 if(data.startsWith('manage:')&&isAdmin(id)){const p=products().find(x=>x.id===data.slice(7));if(!p)return send(chat,'المنتج غير موجود.');return send(chat,`إدارة: <b>${p.title}</b>\nالسعر: ${money(p.price)}\nأقل كمية: ${p.minQty||1}`,{reply_markup:keyboard([[{text:'💰 تعديل السعر',callback_data:`price:${p.id}`},{text:'📦 تعديل أقل كمية',callback_data:`min:${p.id}`}],[{text:p.active===false?'إظهار المنتج':'إخفاء المنتج',callback_data:`toggle:${p.id}`}],[{text:'🔙 رجوع',callback_data:'admin'}]])});}
 if((data.startsWith('price:')||data.startsWith('min:'))&&isAdmin(id)){const ss=sessions(),isPrice=data.startsWith('price:');ss[id]={...(ss[id]||{}),step:isPrice?'setprice':'setmin',productId:data.slice(isPrice?6:4)};saveSessions(ss);return send(chat,isPrice?'أرسل السعر الجديد بالدينار (مثال 1200):':'أرسل أقل كمية جديدة (مثال 12):');}
 if(data.startsWith('toggle:')&&isAdmin(id)){const list=products(),p=list.find(x=>x.id===data.slice(7));if(!p)return send(chat,'المنتج غير موجود.');p.active=p.active===false?true:false;saveProducts(list);return send(chat,p.active?'تم إظهار المنتج.':'تم إخفاء المنتج.');}
 if(data==='orders'&&isAdmin(id)){const list=orders().slice(0,20);if(!list.length)return send(chat,'لا توجد طلبيات.');return send(chat,list.map(o=>`${o.id} | ${o.customer.name} | ${o.status}`).join('\n'));}
 if((data.startsWith('accept:')||data.startsWith('reject:'))&&isAdmin(id)){const idOrder=data.split(':')[1],list=orders(),o=list.find(x=>x.id===idOrder);if(!o)return send(chat,'الطلب غير موجود.');o.status=data.startsWith('accept:')?'مقبول':'مرفوض';saveOrders(list);await send(o.userId,`تحديث الطلب ${o.id}: <b>${o.status}</b>`);return send(chat,`تم تحديث حالة ${o.id}.`);}
 if(data==='myorders'){const mine=orders().filter(o=>o.userId===id);return send(chat,mine.length?mine.map(o=>`${o.id} — ${o.status}`).join('\n'):'ليس لديك طلبيات حالياً.');}
}
app.post('/telegram/webhook',async(req,res)=>{if(WEBHOOK_SECRET&&req.get('x-telegram-bot-api-secret-token')!==WEBHOOK_SECRET)return res.sendStatus(401);res.sendStatus(200);try{const update=req.body;if(update.message?.text)await handleText(update.message);if(update.callback_query)await callback(update.callback_query);const post=update.channel_post;if(post){const parsed=parsePost(post),id=`${post.chat.id}_${post.message_id}`;let image='';if(parsed.photoFileId)image=await saveTelegramPhoto(parsed.photoFileId,id);const list=products(),idx=list.findIndex(p=>p.id===id);const record={id,title:parsed.title,price:parsed.price,description:parsed.description,image,minQty:1,active:true,createdAt:new Date((post.date||Date.now()/1000)*1000).toISOString(),telegramLink:`https://t.me/${CHANNEL_USERNAME}/${post.message_id}`};if(idx>=0)list[idx]={...list[idx],...record,price:list[idx].price||record.price,minQty:list[idx].minQty||1};else list.unshift(record);saveProducts(list);}}catch(e){console.error('Webhook error:',e.message);}});
app.get('/api/products',(req,res)=>res.json(products()));app.get('/health',(req,res)=>res.json({ok:true}));
app.get('/setup-webhook',async(req,res)=>{const base=(process.env.APP_URL||'').replace(/\/$/,'');if(!base)return res.status(400).json({error:'Set APP_URL'});try{const result=await telegram('setWebhook',{url:`${base}/telegram/webhook`,...(WEBHOOK_SECRET?{secret_token:WEBHOOK_SECRET}:{}),allowed_updates:['message','callback_query','channel_post']});res.json({ok:true,result});}catch(e){res.status(500).json({error:e.message});}});
app.listen(PORT,async()=>{console.log(`Catalog running on ${PORT}`);if(!BOT_TOKEN){console.error('TELEGRAM_BOT_TOKEN missing');return;}const base=(process.env.APP_URL||'').replace(/\/$/,'');if(base)try{await telegram('setWebhook',{url:`${base}/telegram/webhook`,...(WEBHOOK_SECRET?{secret_token:WEBHOOK_SECRET}:{}),allowed_updates:['message','callback_query','channel_post']});console.log('Telegram webhook configured');}catch(e){console.error('Webhook setup error:',e.message);}});
