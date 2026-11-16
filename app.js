const categories=[['🚘','السيارات'],['🏡','العقارات'],['📱','موبايلات'],['💻','إلكترونيات'],['🛋️','أثاث ومنزل'],['👕','ملابس وإكسسوارات'],['🧰','خدمات'],['💼','وظائف']];
const $=id=>document.getElementById(id);
let supabaseClient=null,signUpMode=false,currentSession=null,isAdmin=false;

categories.forEach(([icon,name])=>{
  const d=document.createElement('div');
  d.className='cat';
  d.innerHTML=`<b>${icon}</b><span>${name}</span>`;
  d.onclick=()=>{$('categoryFilter').value=name;loadListings()};
  $('cats').appendChild(d);
});

function toast(m){
  $('toast').textContent=m;
  $('toast').style.display='block';
  setTimeout(()=>$('toast').style.display='none',3500);
}

function escapeHtml(s){
  return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* نافذة تفاصيل الإعلان */
function openImageViewer(src,title='صورة الإعلان'){
  if(!src)return;
  let viewer=$('imageViewerDialog');
  if(!viewer){
    viewer=document.createElement('dialog');
    viewer.id='imageViewerDialog';
    viewer.style.cssText='width:96%;max-width:1000px;max-height:94vh;border:0;border-radius:14px;padding:12px;background:#111;color:#fff';
    document.body.appendChild(viewer);
  }
  viewer.innerHTML=`<button id="closeImageViewer" style="float:left;padding:8px 13px">✕</button><p style="text-align:center">${escapeHtml(title)}</p><img src="${escapeHtml(src)}" style="display:block;width:100%;max-height:78vh;object-fit:contain">`;
  $('closeImageViewer').onclick=()=>viewer.close();
  if(!viewer.open)viewer.showModal();
}

async function openMyProfile(){
  if(!currentSession?.user){$('authDialog').showModal();return}
  let dialog=$('sellerProfileDialog');
  if(!dialog){
    dialog=document.createElement('dialog');
    dialog.id='sellerProfileDialog';
    dialog.className='sellerProfileDialog';
    document.body.appendChild(dialog);
  }
  dialog.innerHTML='<form id="sellerProfileForm" class="sellerProfileForm"><button type="button" class="sellerProfileClose">×</button><small>حساب البائع</small><h2>ملفي الشخصي</h2><label>الاسم الظاهر للمتسوقين</label><input name="display_name" maxlength="60" placeholder="اكتب اسمك أو اسم متجرك"><label>رقم التواصل الشخصي (اختياري)</label><input name="phone" type="tel" maxlength="20" placeholder="رقم الهاتف"><p class="sellerProfileNote">بيانات الملف الشخصي خاصة بحسابك حاليًا، ولا نعرضها للعامة تلقائيًا.</p><button type="submit">حفظ البيانات</button><p class="sellerProfileMessage" aria-live="polite"></p></form>';
  dialog.querySelector('.sellerProfileClose').onclick=()=>dialog.close();
  const form=dialog.querySelector('form');
  const {data,error}=await supabaseClient.from('profiles').select('display_name,phone').eq('id',currentSession.user.id).maybeSingle();
  if(error){toast('تعذر تحميل الملف الشخصي: '+error.message);return}
  form.elements.display_name.value=data?.display_name||'';
  form.elements.phone.value=data?.phone||'';
  form.onsubmit=async e=>{
    e.preventDefault();
    const display_name=form.elements.display_name.value.trim();
    const phone=form.elements.phone.value.trim();
    if(display_name.length>60){form.querySelector('.sellerProfileMessage').textContent='الاسم يجب ألا يتجاوز 60 حرفًا.';return}
    if(phone&&!/^[+0-9\\s()-]{8,20}$/.test(phone)){form.querySelector('.sellerProfileMessage').textContent='راجع رقم الهاتف.';return}
    const {error:saveError}=await supabaseClient.from('profiles').upsert({id:currentSession.user.id,display_name:display_name||null,phone:phone||null,updated_at:new Date().toISOString()},{onConflict:'id'});
    if(saveError){form.querySelector('.sellerProfileMessage').textContent='تعذر الحفظ: '+saveError.message;return}
    toast('تم حفظ بيانات ملفك الشخصي.');
    dialog.close();
  };
  if(!dialog.open)dialog.showModal();
}

async function showSellerStore(sellerId){
  if(!sellerId||!supabaseClient)return;
  let dialog=$('sellerStoreDialog');
  if(!dialog){
    dialog=document.createElement('dialog');
    dialog.id='sellerStoreDialog';
    dialog.className='sellerStoreDialog';
    document.body.appendChild(dialog);
  }
  dialog.innerHTML='<div class="sellerStoreHead"><div><small>AVQENZA MARKETPLACE</small><h2>متجر البائع</h2><p>الإعلانات المنشورة لهذا البائع</p></div><button type="button" class="sellerStoreClose">×</button></div><div class="sellerStoreBody"><div class="empty">جاري تحميل إعلانات المتجر...</div></div>';
  dialog.querySelector('.sellerStoreClose').onclick=()=>dialog.close();
  if(!dialog.open)dialog.showModal();
  const {data,error}=await supabaseClient.from('listings')
    .select('id,title,description,price,city,phone,category,image_url,image_urls,condition,status,created_at,seller_id')
    .eq('seller_id',sellerId).eq('status','approved')
    .order('created_at',{ascending:false}).limit(40);
  const body=dialog.querySelector('.sellerStoreBody');
  if(error){body.innerHTML='<div class="empty">تعذر تحميل المتجر حاليًا.</div>';return}
  if(!data?.length){body.innerHTML='<div class="empty">لا توجد إعلانات منشورة لهذا البائع حاليًا.</div>';return}
  body.innerHTML='<div class="sellerStoreStats"><strong>'+data.length.toLocaleString('ar-EG')+'</strong><span>إعلان منشور</span></div><div class="sellerStoreGrid"></div>';
  const grid=body.querySelector('.sellerStoreGrid');
  data.forEach(item=>{
    const card=document.createElement('article');
    card.className='item sellerStoreCard';
    const img=item.image_url||'';
    const price=Number(item.price)>0?Number(item.price).toLocaleString('ar-EG')+' جنيه':'السعر عند التواصل';
    card.innerHTML=`${img?`<img src="${escapeHtml(img)}" alt="${escapeHtml(item.title)}" loading="lazy">`:''}<div class="itemBody"><h3>${escapeHtml(item.title)}</h3><div class="price">${price}</div><small>${escapeHtml(item.category||'')} · ${escapeHtml(item.city||'')}</small><button type="button" class="detailsBtn">عرض الإعلان</button></div>`;
    card.querySelector('.detailsBtn').onclick=()=>{dialog.close();showListingDetails(item)};
    card.querySelector('img')?.addEventListener('click',()=>openImageViewer(img,item.title));
    grid.appendChild(card);
  });
}

function showListingDetails(x){
  let dialog=$('listingDetailsDialog');
  if(!dialog){
    dialog=document.createElement('dialog');
    dialog.id='listingDetailsDialog';
    document.body.appendChild(dialog);
  }

  const phone=String(x.phone||'').replace(/[^0-9+]/g,'');
  const wa=phone.replace(/^\\+/,'').replace(/^0/,'20');
  const price=Number(x.price)>0?Number(x.price).toLocaleString('ar-EG')+' جنيه':'السعر عند التواصل';
  const images=Array.isArray(x.image_urls)&&x.image_urls.length?x.image_urls:(x.image_url?[x.image_url]:[]);
  const conditionLabel=x.condition==='new'?'جديد':x.condition==='used'?'مستعمل':'غير محدد';
  const dateLabel=x.created_at?new Date(x.created_at).toLocaleDateString('ar-EG'):'غير متاح';
  const contact=phone
    ? `<div class="detailContactActions"><a class="detailCall" href="tel:${escapeHtml(phone)}">اتصال بالبائع</a><a class="detailWhatsapp" href="https://wa.me/${escapeHtml(wa)}" target="_blank" rel="noopener">مراسلة عبر واتساب</a></div>`
    : '<p class="detailNoContact">لا يوجد رقم تواصل معلن لهذا الإعلان.</p>';

  dialog.innerHTML=`
    <div class="listingDetails">
      <button type="button" id="closeListingDetails" class="detailClose" aria-label="إغلاق">×</button>
      <div class="detailEyebrow">AVQENZA MARKETPLACE</div>
      <div class="detailGallery">
        ${images.length
          ? `<div class="detailMainImage"><img id="detailMainImage" src="${escapeHtml(images[0])}" alt="${escapeHtml(x.title)}">${images.length>1?'<button type="button" class="detailImageNav detailPrev" aria-label="الصورة السابقة">‹</button><button type="button" class="detailImageNav detailNext" aria-label="الصورة التالية">›</button>':''}</div><div class="detailThumbnails">${images.map((url,i)=>`<button type="button" class="detailThumb ${i===0?'active':''}" data-image-index="${i}" aria-label="عرض الصورة ${i+1}"><img src="${escapeHtml(url)}" alt=""></button>`).join('')}</div>`
          : '<div class="detailNoImage">لا توجد صور مرفقة بهذا الإعلان</div>'}
      </div>
      <div class="detailContent">
        <div class="detailMeta"><span>${escapeHtml(x.category||'إعلان')}</span><span>${escapeHtml(x.city||'الموقع غير محدد')}</span></div>
        <h2>${escapeHtml(x.title)}</h2>
        <div class="detailPrice">${price}</div>
        <div class="detailFacts">
          <div><small>حالة المنتج</small><strong>${conditionLabel}</strong></div>
          <div><small>تاريخ النشر</small><strong>${dateLabel}</strong></div>
          <div><small>عدد الصور</small><strong>${images.length.toLocaleString('ar-EG')}</strong></div>
        </div>
        <section class="detailDescription"><h3>وصف الإعلان</h3><p>${escapeHtml(x.description||'لا يوجد وصف إضافي.')}</p></section>
        <section class="detailSeller"><div class="detailSellerIcon">AV</div><div class="detailSellerInfo"><strong>التواصل مع البائع</strong><small>تصفح الإعلانات المنشورة لهذا البائع</small></div><button type="button" id="viewSellerStore" class="viewSellerStore">زيارة المتجر</button></section>
        ${contact}
        <p class="detailSafety">نصيحة: افحص المنتج وتأكد من تفاصيله قبل إتمام عملية الشراء.</p>
      </div>
    </div>
  `;

  $('closeListingDetails').onclick=()=>dialog.close();
  $('viewSellerStore').onclick=()=>showSellerStore(x.seller_id);
  let activeIndex=0;
  const mainImage=$('detailMainImage');
  const thumbnails=Array.from(dialog.querySelectorAll('.detailThumb'));
  const showImage=(index)=>{
    if(!images.length)return;
    activeIndex=(index+images.length)%images.length;
    mainImage.src=images[activeIndex];
    thumbnails.forEach((button,i)=>button.classList.toggle('active',i===activeIndex));
  };
  thumbnails.forEach(button=>button.addEventListener('click',()=>showImage(Number(button.dataset.imageIndex))));
  dialog.querySelector('.detailPrev')?.addEventListener('click',()=>showImage(activeIndex-1));
  dialog.querySelector('.detailNext')?.addEventListener('click',()=>showImage(activeIndex+1));
  mainImage?.addEventListener('click',()=>openImageViewer(images[activeIndex],x.title));
  if(!dialog.open)dialog.showModal();
}
function updateAuthUI(session){
  currentSession=session;
  const b=$('loginBtn');
  if(!b)return;
  if(session?.user){
    b.textContent=session.user.email||'حسابي';
    b.title='اضغط لتسجيل الخروج';
    b.onclick=async()=>{
      const {error}=await supabaseClient.auth.signOut();
      if(error){toast('تعذر تسجيل الخروج: '+error.message);return}
      toast('تم تسجيل الخروج');
    };
  }else{
    b.textContent='تسجيل الدخول';
    b.title='';
    b.onclick=()=>$('authDialog').showModal();
    isAdmin=false;
    $('adminSection')?.setAttribute('hidden','');
  }
}
async function init(){
  const u=window.AVQENZA_SUPABASE_URL,k=window.AVQENZA_SUPABASE_ANON_KEY;
  if(!window.supabase||!u||!k){
    $('listingGrid').innerHTML='<div class="empty">إعدادات الاتصال بقاعدة البيانات غير مكتملة.</div>';
    return;
  }
  supabaseClient=window.supabase.createClient(u,k);
  const {data,error}=await supabaseClient.auth.getSession();
  if(error)toast('تعذر التحقق من الجلسة: '+error.message);
  updateAuthUI(data?.session||null);
  await checkAdmin();
  supabaseClient.auth.onAuthStateChange(async(_event,session)=>{
    updateAuthUI(session);
    await checkAdmin();
  });
  await loadListings();
  await loadFeaturedListings();
}

async function loadListings(){
  const grid=$('listingGrid');
  if(!supabaseClient)return;
  grid.innerHTML='<div class="empty">جاري تحميل الإعلانات...</div>';
  let q=supabaseClient.from('listings')
    .select('id,title,description,price,city,phone,category,image_url,image_urls,condition,status,created_at,seller_id')
    .eq('status','approved')
    .order('created_at',{ascending:false})
    .limit(40);
  const term=$('searchInput').value.trim(),cat=$('categoryFilter').value;
  if(term)q=q.ilike('title',`%${term}%`);
  if(cat)q=q.eq('category',cat);
  const {data,error}=await q;
  if(error){
    grid.innerHTML='<div class="empty">تعذر تحميل الإعلانات حاليًا. '+escapeHtml(error.message)+'</div>';
    return;
  }
  grid.innerHTML='';
  if(!data?.length){
    grid.innerHTML='<div class="empty">لا توجد إعلانات منشورة حاليًا. كن أول من يضيف إعلانًا!</div>';
    return;
  }

  data.forEach(x=>{
    const card=document.createElement('article');
    card.className='item';
    const img=x.image_url||'';
    const imageCount=Array.isArray(x.image_urls)&&x.image_urls.length?x.image_urls.length:(img?1:0);
    const conditionLabel=x.condition==='new'?'جديد':x.condition==='used'?'مستعمل':'';
    const price=Number(x.price)>0?Number(x.price).toLocaleString('ar-EG')+' جنيه':'السعر عند التواصل';
    const phone=String(x.phone||'').replace(/[^0-9+]/g,'');
    const wa=phone.replace(/^\+/,'').replace(/^0/,'20');

    card.innerHTML=`
      <div class="listingPhotoWrap">${img?`<img src="${escapeHtml(img)}" alt="${escapeHtml(x.title)}" loading="lazy">`:'<div class="listingPhotoEmpty"></div>'}${imageCount>1?`<span class="photoCount">＋${imageCount-1} صور</span>`:''}${conditionLabel?`<span class="conditionTag">${conditionLabel}</span>`:''}</div>
      <div class="itemBody">
        <h3>${escapeHtml(x.title)}</h3>
        <div class="price">${price}</div>
        <p>${escapeHtml(x.description||'')}</p>
        <small>${escapeHtml(x.category||'')} · ${escapeHtml(x.city||'')}</small>
        <div style="margin-top:12px">
          <button type="button" class="detailsBtn" style="padding:10px 16px;border:0;border-radius:8px;background:#1769aa;color:white;cursor:pointer">عرض التفاصيل</button>
        </div>
        ${phone?`<p><a href="tel:${escapeHtml(phone)}">اتصال بالبائع</a> · <a target="_blank" rel="noopener" href="https://wa.me/${escapeHtml(wa)}">واتساب</a></p>`:''}
      </div>`;
    card.querySelector('.detailsBtn').onclick=()=>showListingDetails(x);
    card.querySelector('img')?.addEventListener('click',()=>openImageViewer(img,x.title));
if(card.querySelector('img'))card.querySelector('img').style.cursor='zoom-in';
    grid.appendChild(card);
  });
}
async function loadFeaturedListings(){
  const grid=$('featuredGrid');
  if(!grid || !supabaseClient)return;

  grid.innerHTML='<div class="empty">جاري تحميل الإعلانات المميزة...</div>';

  const {data,error}=await supabaseClient
    .from('listings')
    .select('id,title,description,price,city,phone,category,image_url,image_urls,condition,status,created_at,seller_id')
    .eq('status','approved')
    .eq('is_featured',true)
    .order('created_at',{ascending:false})
    .limit(4);

  if(error){
    grid.innerHTML='<div class="empty">تعذر تحميل الإعلانات المميزة.</div>';
    console.error(error);
    return;
  }

  grid.innerHTML='';

  if(!data?.length){
    grid.innerHTML='<div class="empty">لا توجد إعلانات مميزة حاليًا.</div>';
    return;
  }

  data.forEach(x=>{
    const card=document.createElement('article');
    card.className='item';

    const img=x.image_url||'';
    const imageCount=Array.isArray(x.image_urls)&&x.image_urls.length?x.image_urls.length:(img?1:0);
    const conditionLabel=x.condition==='new'?'جديد':x.condition==='used'?'مستعمل':'';
    const price=Number(x.price)>0
      ?Number(x.price).toLocaleString('ar-EG')+' جنيه'
      :'السعر عند التواصل';

    const phone=String(x.phone||'').replace(/[^0-9+]/g,'');
    const wa=phone.replace(/^\+/,'').replace(/^0/,'20');

    card.innerHTML=`
      <div class="listingPhotoWrap">${img?`<img src="${escapeHtml(img)}" alt="${escapeHtml(x.title)}" loading="lazy">`:'<div class="listingPhotoEmpty"></div>'}${imageCount>1?`<span class="photoCount">＋${imageCount-1} صور</span>`:''}${conditionLabel?`<span class="conditionTag">${conditionLabel}</span>`:''}</div>
      <div class="itemBody">
        <h3>${escapeHtml(x.title)}</h3>
        <div class="price">${price}</div>
        <p>${escapeHtml(x.description||'')}</p>
        <small>${escapeHtml(x.category||'')} · ${escapeHtml(x.city||'')}</small>
        <div style="margin-top:12px">
          <button type="button" class="detailsBtn" style="padding:10px 16px;border:0;border-radius:8px;background:#1769aa;color:white;cursor:pointer">عرض التفاصيل</button>
        </div>
        ${phone?`<p><a href="tel:${escapeHtml(phone)}">اتصال بالبائع</a> · <a target="_blank" rel="noopener" href="https://wa.me/${escapeHtml(wa)}">واتساب</a></p>`:''}
      </div>`;

    card.querySelector('.detailsBtn').onclick=()=>showListingDetails(x);
    card.querySelector('img')?.addEventListener('click',()=>openImageViewer(img,x.title));
    if(card.querySelector('img'))card.querySelector('img').style.cursor='zoom-in';

    grid.appendChild(card);
  });
}
async function loadPendingListings(){
  if(!isAdmin)return;
  const box=$('adminListings');
  box.innerHTML='<div class="empty">جاري تحميل الإعلانات المعلقة...</div>';
  const {data,error}=await supabaseClient.from('listings')
    .select('id,title,description,price,city,phone,category,created_at')
    .eq('status','pending')
    .order('created_at',{ascending:true})
    .limit(100);
  if(error){
    box.innerHTML='<div class="empty">تعذر تحميل لوحة المراجعة: '+escapeHtml(error.message)+'</div>';
    return;
  }
  box.innerHTML='';
  if(!data?.length){
    box.innerHTML='<div class="empty">لا توجد إعلانات بانتظار المراجعة.</div>';
    return;
  }
  data.forEach(x=>{
    const el=document.createElement('article');
    el.className='item';
    el.innerHTML=`<div class="itemBody"><h3>${escapeHtml(x.title)}</h3><p>${escapeHtml(x.description||'')}</p><small>${escapeHtml(x.category||'')} · ${escapeHtml(x.city||'')} · ${Number(x.price).toLocaleString('ar-EG')} جنيه</small><div class="adminActions"><button data-action="approved">اعتماد الإعلان</button><button class="outline" data-action="rejected">رفض</button></div></div>`;
    el.querySelectorAll('button').forEach(btn=>btn.onclick=()=>moderateListing(x.id,btn.dataset.action));
    box.appendChild(el);
  });
}
// قسم إعلاناتي
async function loadMyListings(){
  const box=$('myListings');
  if(!supabaseClient||!currentSession?.user)return;
  box.innerHTML='<div class="empty">جاري تحميل إعلاناتك...</div>';

  const {data,error}=await supabaseClient.from('listings')
    .select('id,title,description,price,city,phone,category,image_url,image_urls,condition,status')
    .eq('seller_id',currentSession.user.id)
    .order('created_at',{ascending:false});

  if(error){
    box.innerHTML='<div class="empty">تعذر تحميل إعلاناتك: '+escapeHtml(error.message)+'</div>';
    return;
  }

  box.innerHTML='';
  if(!data?.length){
    box.innerHTML='<div class="empty">ليس لديك إعلانات حتى الآن.</div>';
    return;
  }

  data.forEach(x=>{
    const el=document.createElement('article');
    el.className='item';
    el.innerHTML=`
      ${x.image_url?`<img src="${escapeHtml(x.image_url)}" alt="${escapeHtml(x.title)}">`:''}
      <div class="itemBody">
        <h3>${escapeHtml(x.title)}</h3>
        <p>${escapeHtml(x.description||'')}</p>
        <small>${escapeHtml(x.category||'')} · ${escapeHtml(x.city||'')}</small>
        <p>الحالة: ${escapeHtml(x.status)}</p>
        <button class="editMyAd">تعديل الإعلان</button>
        <button class="deleteMyAd outline">حذف الإعلان</button>
        <input class="changeMyAdImage" type="file" accept="image/jpeg,image/png,image/webp" multiple>
      </div>`;

    el.querySelector('.editMyAd').onclick=()=>editMyListing(x);
        el.querySelector('.changeMyAdImage').onchange=async(e)=>{
  const files=Array.from(e.target.files||[]);
  if(!files.length)return;

  if(files.some(file=>file.size>5*1024*1024)){
    toast('حجم كل صورة يجب ألا يتجاوز 5 ميجابايت.');
    return;
  }

  if(files.some(file=>!['image/jpeg','image/png','image/webp'].includes(file.type))){
    toast('اختر صور JPG أو PNG أو WebP فقط.');
    return;
  }

  const user=currentSession.user;
  const urls=Array.isArray(x.image_urls)&&x.image_urls.length
    ? [...x.image_urls]
    : (x.image_url?[x.image_url]:[]);

  for(let i=0;i<files.length;i++){
    const file=files[i];
    const path=`${user.id}/${Date.now()}-${i}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;

    const up=await supabaseClient.storage.from('listing-images').upload(path,file);
    if(up.error){
      toast('تعذر رفع الصورة: '+up.error.message);
      return;
    }

    const url=supabaseClient.storage.from('listing-images').getPublicUrl(path).data.publicUrl;
    urls.push(url);
  }

  const {error}=await supabaseClient.from('listings').update({
    image_url:urls[0]||null,
    image_urls:urls,
    status:'pending'
  }).eq('id',x.id).eq('seller_id',user.id);

  if(error){
    toast('تعذر حفظ الصور: '+error.message);
    return;
  }

  toast('تم إضافة الصور، والإعلان بانتظار المراجعة.');
  await loadMyListings();
  await loadListings();
};
    
    el.querySelector('.deleteMyAd').onclick=()=>deleteMyListing(x.id);
    box.appendChild(el);
  });
}

async function editMyListing(x){
  const dialog=$('editAdDialog');
  const form=$('editAdForm');

  if(!dialog||!form){
    toast('تعذر فتح نموذج التعديل.');
    return;
  }

  form.elements.title.value=x.title||'';
  form.elements.description.value=x.description||'';
  form.elements.price.value=x.price||0;
  form.elements.phone.value=x.phone||'';
  form.elements.city.value=x.city||'';
  form.elements.condition.value=x.condition||'used';
  form.elements.image.value='';

  const currentImages=Array.isArray(x.image_urls)&&x.image_urls.length
    ? x.image_urls
    : (x.image_url?[x.image_url]:[]);
  const imageNote=form.querySelector('[data-current-images]');
  if(imageNote)imageNote.textContent=currentImages.length
    ? `الصور الحالية: ${currentImages.length} — الصور الجديدة ستُضاف إليها.`
    : 'لا توجد صور حالية.';

  dialog.showModal();

  form.onsubmit=async(e)=>{
    e.preventDefault();

    const title=form.elements.title.value.trim();
    const description=form.elements.description.value.trim();
    const price=Number(form.elements.price.value);
    const phone=form.elements.phone.value.trim();
    const city=form.elements.city.value.trim();
    const condition=form.elements.condition.value;
    const files=Array.from(form.elements.image.files||[]);

    if(title.length<4||!description||!Number.isFinite(price)||price<0){
      toast('راجع البيانات وحاول مرة أخرى.');
      return;
    }

    if(!['new','used'].includes(condition)){
      toast('اختر حالة المنتج.');
      return;
    }

    if(files.length+currentImages.length>5){
      toast(`يمكن أن يحتوي الإعلان على 5 صور كحد أقصى. لديك ${currentImages.length} صور حالية.`);
      return;
    }

    if(files.some(file=>file.size>5*1024*1024)){
      toast('حجم كل صورة يجب ألا يتجاوز 5 ميجابايت.');
      return;
    }

    if(files.some(file=>!['image/jpeg','image/png','image/webp'].includes(file.type))){
      toast('اختر صور JPG أو PNG أو WebP فقط.');
      return;
    }

    const {data:{user},error:ue}=await supabaseClient.auth.getUser();
    if(ue||!user){
      toast('سجل الدخول أولًا.');
      return;
    }

    const urls=[...currentImages];
    const uploadedPaths=[];

    for(let i=0;i<files.length;i++){
      const file=files[i];
      const path=`${user.id}/${Date.now()}-${i}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
      const up=await supabaseClient.storage.from('listing-images').upload(path,file);

      if(up.error){
        if(uploadedPaths.length)await supabaseClient.storage.from('listing-images').remove(uploadedPaths);
        toast('تعذر رفع الصورة: '+up.error.message);
        return;
      }

      uploadedPaths.push(path);
      const url=supabaseClient.storage.from('listing-images').getPublicUrl(path).data.publicUrl;
      urls.push(url);
    }

    const {error}=await supabaseClient.from('listings').update({
      title,
      description,
      price,
      phone,
      city,
      condition,
      image_url:urls[0]||null,
      image_urls:urls,
      status:'pending'
    }).eq('id',x.id).eq('seller_id',user.id);

    if(error){
      if(uploadedPaths.length)await supabaseClient.storage.from('listing-images').remove(uploadedPaths);
      toast('تعذر تعديل الإعلان: '+error.message);
      return;
    }

    dialog.close();
    toast('تم حفظ التعديلات، والإعلان بانتظار المراجعة.');
    await loadMyListings();
    await loadListings();
  };
}

async function deleteMyListing(id){
  if(!confirm('هل أنت متأكد من حذف الإعلان؟'))return;

  const {error}=await supabaseClient.from('listings')
    .delete().eq('id',id).eq('seller_id',currentSession.user.id);

  if(error){toast('تعذر حذف الإعلان: '+error.message);return}
  toast('تم حذف الإعلان.');
  await loadMyListings();
  await loadListings();
}

const myBtn=document.createElement('button');
myBtn.className='outline';
myBtn.textContent='إعلاناتي';
$('loginBtn').parentElement.insertBefore(myBtn,$('addTop'));

const profileBtn=document.createElement('button');
profileBtn.className='outline';
profileBtn.textContent='ملفي الشخصي';
$('loginBtn').parentElement.insertBefore(profileBtn,myBtn);
profileBtn.onclick=openMyProfile;

myBtn.onclick=async()=>{
  if(!currentSession?.user){
    $('authDialog').showModal();
    return;
  }
  const section=$('myListingsSection');
  section.removeAttribute('hidden');
  section.scrollIntoView({behavior:'smooth'});
  await loadMyListings();
};

$('myListingsRefresh').onclick=loadMyListings;

async function moderateListing(id,status){
  if(!isAdmin)return toast('ليس لديك صلاحية الإدارة.');
  const {error}=await supabaseClient.from('listings').update({status}).eq('id',id).eq('status','pending');
  if(error){toast('تعذر تحديث الإعلان: '+error.message);return}
  toast(status==='approved'?'تم اعتماد الإعلان.':'تم رفض الإعلان.');
  await loadPendingListings();
  await loadListings();
}

$('searchBtn').onclick=loadListings;
$('refreshBtn').onclick=loadListings;
$('addTop').onclick=async()=>{
  if(!supabaseClient){toast('قاعدة البيانات غير متصلة.');return}
  const {data,error}=await supabaseClient.auth.getSession();
  if(error){toast('تعذر التحقق من تسجيل الدخول.');return}
  if(data.session)$('adDialog').showModal();
  else $('authDialog').showModal();
};
$('loginBtn').onclick=()=>$('authDialog').showModal();
$('signupTop').onclick=()=>{
  signUpMode=true;
  $('authTitle').textContent='إنشاء حساب';
  $('authSubmit').textContent='إنشاء الحساب';
  $('authMsg').textContent='';
  $('authSwitch').innerHTML='لديك حساب؟ <a href="#" id="signupLink">تسجيل الدخول</a>';
  $('authDialog').showModal();
};

$('authSwitch').addEventListener('click',e=>{
  if(e.target.id!=='signupLink')return;
  e.preventDefault();
  signUpMode=!signUpMode;
  $('authTitle').textContent=signUpMode?'إنشاء حساب':'تسجيل الدخول';
  $('authSubmit').textContent=signUpMode?'إنشاء الحساب':'دخول';
  $('authMsg').textContent='';
  $('authSwitch').innerHTML=signUpMode?'لديك حساب؟ <a href="#" id="signupLink">تسجيل الدخول</a>':'ليس لديك حساب؟ <a href="#" id="signupLink">إنشاء حساب</a>';
});

async function loadAdminDashboard(){
  if(!isAdmin)return;

  const stats=$('adminStats');
  stats.innerHTML='<div class="empty">جاري تحميل الإحصائيات...</div>';

  const [users,all,approved,pending,rejected,reports]=await Promise.all([
    supabaseClient.from('profiles').select('*',{count:'exact',head:true}),
    supabaseClient.from('listings').select('*',{count:'exact',head:true}),
    supabaseClient.from('listings').select('*',{count:'exact',head:true}).eq('status','approved'),
    supabaseClient.from('listings').select('*',{count:'exact',head:true}).eq('status','pending'),
    supabaseClient.from('listings').select('*',{count:'exact',head:true}).eq('status','rejected'),
    supabaseClient.from('reports').select('*',{count:'exact',head:true})
  ]);

  const results=[users,all,approved,pending,rejected,reports];
  const error=results.find(r=>r.error);
  if(error){
    stats.innerHTML='<div class="empty">تعذر تحميل الإحصائيات: '+escapeHtml(error.error.message)+'</div>';
    return;
  }

  const cards=[
    ['المستخدمون',users.count],
    ['كل الإعلانات',all.count],
    ['المنشورة',approved.count],
    ['بانتظار المراجعة',pending.count],
    ['المرفوضة',rejected.count],
    ['البلاغات',reports.count]
  ];

  stats.innerHTML=cards.map(([name,count])=>
    `<div class="adminStat"><strong>${count??0}</strong><span>${name}</span></div>`
  ).join('');

  await Promise.all([
  loadAdminAllListings(),
  loadAdminReports(),
  loadPendingListings(),
  loadAdminUsers()
]);
}

async function loadAdminAllListings(){
  const box=$('adminAllListings');
  box.innerHTML='<div class="empty">جاري تحميل الإعلانات...</div>';

  const {data,error}=await supabaseClient.from('listings')
    .select('id,title,price,city,category,status,created_at,is_featured')
    .order('created_at',{ascending:false})
    .limit(100);

  if(error){
    box.innerHTML='<div class="empty">تعذر تحميل الإعلانات: '+escapeHtml(error.message)+'</div>';
    return;
  }

  box.innerHTML='';
  if(!data?.length){
    box.innerHTML='<div class="empty">لا توجد إعلانات.</div>';
    return;
  }

  data.forEach(x=>{
    const el=document.createElement('article');
    el.className='item';
    const statusNames={
      pending:'بانتظار المراجعة',
      approved:'منشور',
      rejected:'مرفوض',
      sold:'تم البيع'
    };

    el.innerHTML=`
      <div class="itemBody">
        <h3>${escapeHtml(x.title)}</h3>
        <p>${Number(x.price)>0?Number(x.price).toLocaleString('ar-EG')+' جنيه':'السعر عند التواصل'}</p>
        <small>${escapeHtml(x.category||'')} · ${escapeHtml(x.city||'')}</small>
        <p>الحالة: ${statusNames[x.status]||escapeHtml(x.status)}</p>
        ${x.status==='approved'?`
  <p>${x.is_featured?'⭐ إعلان مميز':'إعلان عادي'}</p>
  <button data-featured="true">
    ${x.is_featured?'إلغاء التمييز':'تمييز الإعلان ⭐'}
  </button>
`:''}
        ${x.status==='pending'?`
          <button data-action="approved">اعتماد الإعلان</button>
          <button class="outline" data-action="rejected">رفض الإعلان</button>
        `:''}
      </div>`;

    el.querySelectorAll('button[data-action]').forEach(btn=>{
      btn.onclick=()=>moderateListing(x.id,btn.dataset.action);
    });
    el.querySelector('button[data-featured]')?.addEventListener('click',()=>{
  toggleFeaturedListing(x.id,x.is_featured);
});

box.appendChild(el);
  });
}

async function toggleFeaturedListing(id,currentValue){
  if(!isAdmin)return;

  const {error}=await supabaseClient
    .from('listings')
    .update({is_featured:!currentValue})
    .eq('id',id)
    .eq('status','approved');

  if(error){
    toast('تعذر تحديث الإعلان: '+error.message);
    return;
  }

  toast(!currentValue?'تم تمييز الإعلان ⭐':'تم إلغاء التمييز');
  await loadAdminAllListings();
  await loadFeaturedListings();
  await loadListings();
}
async function loadAdminUsers(){
  const box=$('adminUsers');
  if(!box)return;

  box.innerHTML='<div class="empty">جاري تحميل المستخدمين...</div>';

  const {data:users,error}=await supabaseClient
    .from('profiles')
    .select('id,display_name,created_at')
    .order('created_at',{ascending:false});

  if(error){
    box.innerHTML='<div class="empty">تعذر تحميل المستخدمين: '+escapeHtml(error.message)+'</div>';
    return;
  }

  const {data:listings,error:listingsError}=await supabaseClient
    .from('listings')
    .select('seller_id');

  if(listingsError){
    box.innerHTML='<div class="empty">تعذر تحميل عدد الإعلانات.</div>';
    return;
  }

  if(!users?.length){
    box.innerHTML='<div class="empty">لا يوجد مستخدمون مسجلون.</div>';
    return;
  }

  box.innerHTML='';

  users.forEach(user=>{
    const count=(listings||[]).filter(x=>x.seller_id===user.id).length;
    const el=document.createElement('article');
    el.className='item';

    el.innerHTML=`
      <div class="itemBody">
        <h3>${escapeHtml(user.display_name||'مستخدم بدون اسم')}</h3>
        <p>عدد الإعلانات: ${count}</p>
        <small>تاريخ التسجيل: ${user.created_at?new Date(user.created_at).toLocaleDateString('ar-EG'):'غير متاح'}</small>
      </div>
    `;

    box.appendChild(el);
  });
}

async function loadAdminReports(){
  const box=$('adminReports');
  box.innerHTML='<div class="empty">جاري تحميل البلاغات...</div>';

  const {data,error}=await supabaseClient.from('reports')
    .select('id,reason,created_at,listing_id,listings(title)')
    .order('created_at',{ascending:false})
    .limit(100);

  if(error){
    box.innerHTML='<div class="empty">تعذر تحميل البلاغات: '+escapeHtml(error.message)+'</div>';
    return;
  }

  box.innerHTML='';
  if(!data?.length){
    box.innerHTML='<div class="empty">لا توجد بلاغات حاليًا.</div>';
    return;
  }

  data.forEach(x=>{
    const el=document.createElement('article');
    el.className='item';
    el.innerHTML=`
      <div class="itemBody">
        <h3>بلاغ على: ${escapeHtml(x.listings?.title||'إعلان غير متاح')}</h3>
        <p>${escapeHtml(x.reason)}</p>
        <small>${new Date(x.created_at).toLocaleString('ar-EG')}</small>
      </div>`;
    box.appendChild(el);
  });
}

async function checkAdmin(){
  if(!currentSession?.user){
    isAdmin=false;
    $('adminSection')?.setAttribute('hidden','');
    return;
  }

  const {data,error}=await supabaseClient.rpc('is_admin');
  isAdmin=!error&&data===true;

  if(isAdmin){
    $('adminSection')?.removeAttribute('hidden');
    await loadAdminDashboard();
  }else{
    $('adminSection')?.setAttribute('hidden','');
  }
}

$('adminRefresh').onclick=loadAdminDashboard;
         $('authSubmit').onclick=async()=>{
  if(!supabaseClient)return;
  const email=$('authEmail').value.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g,'').trim().toLowerCase(),password=$('authPassword').value;
  if(!email||!password){$('authMsg').textContent='اكتب البريد الإلكتروني وكلمة المرور.';return}
  const btn=$('authSubmit');
  btn.disabled=true;
  btn.textContent='جارٍ التنفيذ...';
  $('authMsg').textContent='';
  try{
    const r=signUpMode
      ?await supabaseClient.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin}})
      :await supabaseClient.auth.signInWithPassword({email,password});
    if(r.error){$('authMsg').textContent='تعذر إتمام العملية: '+r.error.message;return}
    if(signUpMode&&!r.data.session){
      $('authMsg').textContent='تم إنشاء الحساب. افتح رسالة التأكيد في بريدك ثم ارجع وسجّل الدخول.';
    }else{
      updateAuthUI(r.data.session);
      await checkAdmin();
      $('authMsg').textContent=signUpMode?'تم إنشاء الحساب وتسجيل الدخول.':'تم تسجيل الدخول بنجاح.';
      setTimeout(()=>$('authDialog').close(),800);
      toast('أهلًا بك في AVQENZA');
    }
  }catch(e){
    $('authMsg').textContent='حدث خطأ غير متوقع: '+(e.message||e);
  }finally{
    btn.disabled=false;
    btn.textContent=signUpMode?'إنشاء الحساب':'دخول';
  }
};

$('adSubmit').onclick=async()=>{
  if(!supabaseClient)return;
  const msg=$('adMsg');
  msg.textContent='';
  const {data:{user},error:ue}=await supabaseClient.auth.getUser();
  if(ue||!user){msg.textContent='سجل الدخول أولًا.';return}

  const title=$('adTitle').value.trim();
  const description=$('adDescription').value.trim();
  const priceRaw=$('adPrice').value;
  const category=$('adCategory').value;
  const phone=$('adPhone').value.trim();
  const city=$('adCity')?.value.trim()||'القاهرة';

  if(title.length<4){msg.textContent='اكتب عنوانًا من 4 أحرف على الأقل.';return}
  if(!description){msg.textContent='اكتب وصف الإعلان.';return}
  if(!/^[+0-9\s()-]{8,20}$/.test(phone)){msg.textContent='اكتب رقم موبايل صحيح للتواصل.';return}
  if(priceRaw!==''&&(!Number.isFinite(Number(priceRaw))||Number(priceRaw)<0)){msg.textContent='اكتب سعرًا صحيحًا.';return}

  const {error:pe}=await supabaseClient.from('profiles').upsert({id:user.id},{onConflict:'id',ignoreDuplicates:true});
  if(pe){msg.textContent='تعذر تجهيز ملف البائع: '+pe.message;return}

  const files=Array.from($('adImage').files||[]);
  if(files.length>5){msg.textContent='يمكنك إضافة 5 صور كحد أقصى.';return}
  if(files.some(file=>file.size>5*1024*1024)){msg.textContent='حجم كل صورة يجب ألا يتجاوز 5 ميجابايت.';return}
  if(files.some(file=>!['image/jpeg','image/png','image/webp'].includes(file.type))){msg.textContent='اختر صور JPG أو PNG أو WebP فقط.';return}

  const uploadedPaths=[];
  const imageUrls=[];
  for(let i=0;i<files.length;i++){
    const file=files[i];
    const path=user.id+'/'+Date.now()+'-'+i+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const up=await supabaseClient.storage.from('listing-images').upload(path,file);
    if(up.error){
      if(uploadedPaths.length)await supabaseClient.storage.from('listing-images').remove(uploadedPaths);
      msg.textContent='تعذر رفع الصورة: '+up.error.message;
      return;
    }
    uploadedPaths.push(path);
    imageUrls.push(supabaseClient.storage.from('listing-images').getPublicUrl(path).data.publicUrl);
  }

  const imageUrl=imageUrls[0]||null;
  const condition=$('adCondition').value;
  const payload={seller_id:user.id,title,description,price:priceRaw?Number(priceRaw):0,category,city,phone,condition,image_url:imageUrl,image_urls:imageUrls,status:'pending'};
  const {error:le}=await supabaseClient.from('listings').insert(payload);
  if(le){
    if(uploadedPaths.length)await supabaseClient.storage.from('listing-images').remove(uploadedPaths);
    msg.textContent='تعذر حفظ الإعلان: '+le.message;
    return;
  }
  msg.textContent='تم إرسال إعلانك للمراجعة قبل النشر.';
  $('adDialog').close();
  toast('تم استلام إعلانك للمراجعة.');
  await loadListings();
};

init();
