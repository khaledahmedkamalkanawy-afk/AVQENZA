const categories=[['🚘','السيارات'],['🏡','العقارات'],['📱','موبايلات'],['💻','إلكترونيات'],['🛋️','أثاث ومنزل'],['👕','ملابس وإكسسوارات'],['🧰','خدمات'],['💼','وظائف']];
const $=id=>document.getElementById(id);
let supabaseClient=null,signUpMode=false,currentSession=null,isAdmin=false;
let favoriteIds=new Set();

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
  const user=currentSession.user;
  let dialog=$('sellerProfileDialog');
  if(!dialog){
    dialog=document.createElement('dialog');
    dialog.id='sellerProfileDialog';
    dialog.className='sellerProfileDialog';
    document.body.appendChild(dialog);
  }
  dialog.innerHTML='<form id="sellerProfileForm" class="sellerProfileForm"><button type="button" class="sellerProfileClose">×</button><small>حساب البائع</small><h2>ملفي ومتجري</h2><label>الاسم الظاهر في حسابك</label><input name="display_name" maxlength="60" placeholder="اسمك الشخصي"><label>رقم التواصل الشخصي (خاص)</label><input name="phone" type="tel" maxlength="20" placeholder="رقم الهاتف"><hr><h3>بيانات المتجر العامة</h3><label>اسم المتجر</label><input name="store_name" maxlength="80" placeholder="اسم متجرك"><label>نبذة عن المتجر</label><textarea name="bio" maxlength="500" rows="3" placeholder="اكتب نبذة مختصرة عن نشاطك"></textarea><label>صورة شخصية أو شعار (اختياري)</label><input name="avatar" type="file" accept="image/jpeg,image/png,image/webp"><label>صورة غلاف المتجر (اختياري)</label><input name="cover" type="file" accept="image/jpeg,image/png,image/webp"><p class="sellerProfileNote">اسم المتجر والنبذة والصور تظهر للزوار. رقم هاتفك يظل خاصًا ولا يُعرض من خلال صفحة المتجر.</p><button type="submit">حفظ بيانات المتجر</button><p class="sellerProfileMessage" aria-live="polite"></p></form>';
  dialog.querySelector('.sellerProfileClose').onclick=()=>dialog.close();
  const form=dialog.querySelector('form');
  const [profileResult,storeResult]=await Promise.all([
    supabaseClient.from('profiles').select('display_name,phone').eq('id',user.id).maybeSingle(),
    supabaseClient.from('seller_stores').select('store_name,bio,avatar_url,cover_url').eq('seller_id',user.id).maybeSingle()
  ]);
  if(profileResult.error||storeResult.error){toast('تعذر تحميل بيانات المتجر.');return}
  const profile=profileResult.data||{},store=storeResult.data||{};
  form.elements.display_name.value=profile.display_name||'';
  form.elements.phone.value=profile.phone||'';
  form.elements.store_name.value=store.store_name||profile.display_name||'';
  form.elements.bio.value=store.bio||'';
  form.onsubmit=async e=>{
    e.preventDefault();
    const message=form.querySelector('.sellerProfileMessage');
    const display_name=form.elements.display_name.value.trim();
    const phone=form.elements.phone.value.trim();
    const store_name=form.elements.store_name.value.trim();
    const bio=form.elements.bio.value.trim();
    const avatar=form.elements.avatar.files[0]||null;
    const cover=form.elements.cover.files[0]||null;
    if(phone&&!/^[+0-9\\s()-]{8,20}$/.test(phone)){message.textContent='راجع رقم الهاتف.';return}
    if(!store_name){message.textContent='اكتب اسم المتجر.';return}
    if(bio.length>500){message.textContent='النبذة يجب ألا تتجاوز 500 حرف.';return}
    const files=[avatar,cover].filter(Boolean);
    if(files.some(file=>file.size>3*1024*1024)){message.textContent='حجم كل صورة يجب ألا يتجاوز 3 ميجابايت.';return}
    if(files.some(file=>!['image/jpeg','image/png','image/webp'].includes(file.type))){message.textContent='اختر صور JPG أو PNG أو WebP فقط.';return}
    const uploadStoreImage=async(file,label)=>{
      if(!file)return null;
      const path=user.id+'/store/'+Date.now()+'-'+label+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
      const result=await supabaseClient.storage.from('listing-images').upload(path,file);
      if(result.error)throw result.error;
      return supabaseClient.storage.from('listing-images').getPublicUrl(path).data.publicUrl;
    };
    message.textContent='جاري حفظ البيانات والصور...';
    try{
      const avatarUrl=await uploadStoreImage(avatar,'avatar');
      const coverUrl=await uploadStoreImage(cover,'cover');
      const {error:profileError}=await supabaseClient.from('profiles').upsert({id:user.id,display_name:display_name||null,phone:phone||null,updated_at:new Date().toISOString()},{onConflict:'id'});
      if(profileError)throw profileError;
      const storePayload={seller_id:user.id,store_name,bio:bio||null,updated_at:new Date().toISOString()};
      if(avatarUrl)storePayload.avatar_url=avatarUrl;
      else if(store.avatar_url)storePayload.avatar_url=store.avatar_url;
      if(coverUrl)storePayload.cover_url=coverUrl;
      else if(store.cover_url)storePayload.cover_url=store.cover_url;
      const {error:storeError}=await supabaseClient.from('seller_stores').upsert(storePayload,{onConflict:'seller_id'});
      if(storeError)throw storeError;
      toast('تم حفظ بيانات المتجر بنجاح.');
      dialog.close();
    }catch(error){
      message.textContent='تعذر الحفظ: '+(error.message||'حدث خطأ غير متوقع');
    }
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
  dialog.innerHTML='<div class="sellerStoreHead"><div><small>AVQENZA MARKETPLACE</small><h2>متجر البائع</h2><p>جاري تحميل بيانات المتجر...</p></div><button type="button" class="sellerStoreClose">×</button></div><div class="sellerStoreBody"><div class="empty">جاري تحميل المتجر...</div></div>';
  dialog.querySelector('.sellerStoreClose').onclick=()=>dialog.close();
  if(!dialog.open)dialog.showModal();

  const [storeResult,listingsResult,reviewsResult]=await Promise.all([
    supabaseClient.from('seller_stores').select('store_name,bio,avatar_url,cover_url').eq('seller_id',sellerId).maybeSingle(),
    supabaseClient.from('listings').select('id,title,description,price,city,phone,category,image_url,image_urls,condition,status,created_at,seller_id').eq('seller_id',sellerId).eq('status','approved').order('created_at',{ascending:false}).limit(40),
    supabaseClient.from('seller_reviews').select('rating,comment,created_at,reviewer_id',{count:'exact'}).eq('seller_id',sellerId).order('created_at',{ascending:false}).limit(1000)
  ]);
  const body=dialog.querySelector('.sellerStoreBody');
  if(listingsResult.error||storeResult.error||reviewsResult.error){
    body.innerHTML='<div class="empty">تعذر تحميل المتجر أو تقييماته حاليًا.</div>';
    return;
  }

  const store=storeResult.data||{};
  const name=store.store_name||'متجر البائع';
  const cover=store.cover_url?'<img class="sellerStoreCover" src="'+escapeHtml(store.cover_url)+'" alt="غلاف المتجر">':'<div class="sellerStoreCover sellerStoreCoverEmpty"></div>';
  const avatar=store.avatar_url?'<img class="sellerStoreAvatar" src="'+escapeHtml(store.avatar_url)+'" alt="'+escapeHtml(name)+'">':'<div class="sellerStoreAvatar sellerStoreAvatarEmpty">AV</div>';
  const head=dialog.querySelector('.sellerStoreHead');
  head.outerHTML='<div class="sellerStoreHero">'+cover+'<div class="sellerStoreIdentity">'+avatar+'<div><small>AVQENZA MARKETPLACE</small><h2>'+escapeHtml(name)+'</h2><p>'+escapeHtml(store.bio||'متجر على منصة AVQENZA')+'</p></div><button type="button" class="sellerStoreClose">×</button></div></div>';
  dialog.querySelector('.sellerStoreClose').onclick=()=>dialog.close();

  const reviews=reviewsResult.data||[];
  const reviewCount=reviewsResult.count??reviews.length;
  const average=reviews.length?reviews.reduce((sum,item)=>sum+Number(item.rating||0),0)/reviews.length:0;
  const stars=average?('★'.repeat(Math.round(average))+'☆'.repeat(5-Math.round(average))):'☆☆☆☆☆';
  const alreadyReviewed=!!currentSession?.user&&reviews.some(item=>item.reviewer_id===currentSession.user.id);
  const isOwner=currentSession?.user?.id===sellerId;
  const reviewForm=currentSession?.user
    ? (isOwner?'<p class="sellerReviewHint">لا يمكنك تقييم متجرك بنفسك.</p>'
      : alreadyReviewed?'<p class="sellerReviewHint">سبق لك تقييم هذا المتجر. شكرًا لمشاركتك.</p>'
      : '<form class="sellerReviewForm" id="sellerReviewForm"><h4>أضف تقييمك</h4><label>تقييمك بالنجوم</label><select name="rating" required><option value="5">5 نجوم - ممتاز</option><option value="4">4 نجوم - جيد جدًا</option><option value="3">3 نجوم - جيد</option><option value="2">نجمتان - مقبول</option><option value="1">نجمة - ضعيف</option></select><label>تعليقك</label><textarea name="comment" rows="3" maxlength="500" minlength="3" placeholder="اكتب تجربتك مع هذا البائع" required></textarea><button type="submit">إرسال التقييم</button><p class="sellerReviewMessage" aria-live="polite"></p></form>')
    : '<p class="sellerReviewHint">سجّل الدخول لتقييم هذا المتجر.</p>';

  const reviewItems=reviews.length
    ? reviews.slice(0,8).map(item=>'<article class="sellerReviewItem"><div class="sellerReviewTop"><strong>عضو في AVQENZA</strong><span class="sellerReviewStars">'+('★'.repeat(Number(item.rating))+'☆'.repeat(5-Number(item.rating)))+'</span></div><p>'+escapeHtml(item.comment)+'</p><small>'+new Date(item.created_at).toLocaleDateString('ar-EG')+'</small></article>').join('')
    : '<p class="sellerReviewHint">لا توجد تقييمات لهذا المتجر حتى الآن.</p>';

  body.innerHTML='<div class="sellerStoreStats"><strong>'+((listingsResult.data||[]).length).toLocaleString('ar-EG')+'</strong><span>إعلان منشور</span><strong>'+average.toFixed(1)+'</strong><span>'+stars+' · '+reviewCount.toLocaleString('ar-EG')+' تقييم</span></div><section class="sellerReviews"><h3>تقييمات المتجر</h3>'+reviewForm+'<div class="sellerReviewList">'+reviewItems+'</div></section><div class="sellerStoreGrid"></div>';
  const grid=body.querySelector('.sellerStoreGrid');
  (listingsResult.data||[]).forEach(item=>{
    const card=document.createElement('article');
    card.className='item sellerStoreCard';
    const img=item.image_url||'';
    const price=Number(item.price)>0?Number(item.price).toLocaleString('ar-EG')+' جنيه':'السعر عند التواصل';
    card.innerHTML=`${img?`<img src="${escapeHtml(img)}" alt="${escapeHtml(item.title)}" loading="lazy">`:''}<div class="itemBody"><h3>${escapeHtml(item.title)}</h3><div class="price">${price}</div><small>${escapeHtml(item.category||'')} · ${escapeHtml(item.city||'')}</small><button type="button" class="detailsBtn">عرض الإعلان</button></div>`;
    card.querySelector('.detailsBtn').onclick=()=>{dialog.close();showListingDetails(item)};
    card.querySelector('img')?.addEventListener('click',()=>openImageViewer(img,item.title));
    grid.appendChild(card);
  });
  if(!listingsResult.data?.length)grid.innerHTML='<div class="empty">لا توجد إعلانات منشورة لهذا البائع حاليًا.</div>';

  const reviewFormEl=body.querySelector('#sellerReviewForm');
  if(reviewFormEl)reviewFormEl.onsubmit=async e=>{
    e.preventDefault();
    const message=reviewFormEl.querySelector('.sellerReviewMessage');
    const submit=reviewFormEl.querySelector('button[type="submit"]');
    const rating=Number(reviewFormEl.elements.rating.value);
    const comment=reviewFormEl.elements.comment.value.trim();
    if(!currentSession?.user){message.textContent='سجّل الدخول أولًا.';return}
    if(!Number.isInteger(rating)||rating<1||rating>5||comment.length<3||comment.length>500){message.textContent='راجع التقييم والتعليق (من 3 إلى 500 حرف).';return}
    submit.disabled=true;
    message.textContent='جارٍ إرسال تقييمك...';
    const {error}=await supabaseClient.from('seller_reviews').insert({
      seller_id:sellerId,
      reviewer_id:currentSession.user.id,
      rating,
      comment
    });
    if(error){
      message.textContent=error.code==='23505'?'سبق لك تقييم هذا المتجر.':'تعذر إرسال التقييم: '+error.message;
      submit.disabled=false;
      return;
    }
    toast('تم إرسال تقييمك بنجاح.');
    await showSellerStore(sellerId);
  };
}

async function getAvqenzaVisitorId(){
  const key='avqenza_visitor_id_v1';
  try{
    let id=localStorage.getItem(key);
    if(!id){
      id=globalThis.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)});
      localStorage.setItem(key,id);
    }
    return id;
  }catch(error){
    return globalThis.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)});
  }
}
async function recordListingView(listingId){
  if(!supabaseClient||!listingId)return;
  try{
    const visitorId=await getAvqenzaVisitorId();
    const {error}=await supabaseClient.rpc('record_listing_view',{p_listing_id:listingId,p_visitor_id:visitorId});
    if(error){console.error('Listing view tracking error:',error);return;}
    await loadPopularListings();
  }catch(error){console.error('Listing view tracking error:',error);}
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
        <button type="button" id="detailFavoriteToggle" class="favoriteToggle${favoriteIds.has(x.id)?' isFavorite':''}" data-listing-id="${escapeHtml(x.id)}" aria-pressed="${String(favoriteIds.has(x.id))}">${favoriteIds.has(x.id)?'♥ محفوظ':'♡ أضف للمفضلة'}</button>
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
  $('detailFavoriteToggle').onclick=()=>toggleFavorite(x.id);
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
  if(currentSession?.user?.id!==x.seller_id)recordListingView(x.id);
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
async function loadFavoriteIds(){
  favoriteIds=new Set();
  if(!currentSession?.user||!supabaseClient)return;
  const {data,error}=await supabaseClient.from('favorites').select('listing_id').eq('user_id',currentSession.user.id);
  if(error){console.error('Favorites load error:',error);return}
  (data||[]).forEach(row=>favoriteIds.add(row.listing_id));
  document.querySelectorAll('.favoriteToggle').forEach(btn=>{const saved=favoriteIds.has(btn.dataset.listingId);btn.classList.toggle('isFavorite',saved);btn.textContent=saved?'♥ محفوظ':'♡ أضف للمفضلة';btn.setAttribute('aria-pressed',String(saved));});
}
function addFavoriteControl(card,listing){
  const body=card.querySelector('.itemBody');if(!body)return;
  const button=document.createElement('button');button.type='button';
  button.className='favoriteToggle'+(favoriteIds.has(listing.id)?' isFavorite':'');button.dataset.listingId=listing.id;
  button.textContent=favoriteIds.has(listing.id)?'♥ محفوظ':'♡ أضف للمفضلة';button.setAttribute('aria-label','إضافة الإعلان إلى المفضلة');
  button.setAttribute('aria-pressed',String(favoriteIds.has(listing.id)));button.onclick=()=>toggleFavorite(listing.id);body.appendChild(button);
}
async function toggleFavorite(listingId){
  if(!currentSession?.user){toast('سجّل الدخول أولًا لحفظ الإعلانات.');$('authDialog').showModal();return}
  const userId=currentSession.user.id;
  if(favoriteIds.has(listingId)){const {error}=await supabaseClient.from('favorites').delete().eq('user_id',userId).eq('listing_id',listingId);if(error){toast('تعذر إزالة الإعلان من المفضلة: '+error.message);return}favoriteIds.delete(listingId);toast('تمت إزالة الإعلان من المفضلة.');}
  else{const {error}=await supabaseClient.from('favorites').insert({user_id:userId,listing_id:listingId});if(error){toast(error.code==='23505'?'الإعلان محفوظ بالفعل.':'تعذر حفظ الإعلان: '+error.message);return}favoriteIds.add(listingId);toast('تم حفظ الإعلان في المفضلة ❤️');}
  document.querySelectorAll('.favoriteToggle').forEach(btn=>{if(btn.dataset.listingId!==listingId)return;const saved=favoriteIds.has(listingId);btn.classList.toggle('isFavorite',saved);btn.textContent=saved?'♥ محفوظ':'♡ أضف للمفضلة';btn.setAttribute('aria-pressed',String(saved));});
  if(!$('favoritesSection')?.hasAttribute('hidden'))await loadMyFavorites();
}
async function loadMyFavorites(){
  const box=$('myFavorites');if(!box||!supabaseClient)return;if(!currentSession?.user){box.innerHTML='<div class="empty">سجّل الدخول لعرض إعلاناتك المحفوظة.</div>';return}
  box.innerHTML='<div class="empty">جاري تحميل المفضلة...</div>';
  const {data:rows,error}=await supabaseClient.from('favorites').select('listing_id').eq('user_id',currentSession.user.id).order('created_at',{ascending:false});
  if(error){box.innerHTML='<div class="empty">تعذر تحميل المفضلة: '+escapeHtml(error.message)+'</div>';return}
  const ids=(rows||[]).map(row=>row.listing_id);if(!ids.length){box.innerHTML='<div class="empty">لم تحفظ أي إعلانات حتى الآن. اضغط ♡ أضف للمفضلة على الإعلان الذي يعجبك.</div>';return}
  const {data,error:listingError}=await supabaseClient.from('listings').select('id,title,description,price,city,category,image_url,image_urls,condition,status,created_at,seller_id').in('id',ids).eq('status','approved');
  if(listingError){box.innerHTML='<div class="empty">تعذر تحميل الإعلانات المحفوظة.</div>';return}
  const byId=new Map((data||[]).map(item=>[item.id,item]));box.innerHTML='';
  ids.forEach(id=>{const item=byId.get(id);if(!item)return;const card=document.createElement('article');card.className='item';const img=item.image_url||'';const price=Number(item.price)>0?Number(item.price).toLocaleString('ar-EG')+' جنيه':'السعر عند التواصل';
    card.innerHTML='<div class="listingPhotoWrap">'+(img?'<img src="'+escapeHtml(img)+'" alt="'+escapeHtml(item.title)+'" loading="lazy">':'<div class="listingPhotoEmpty"></div>')+'</div><div class="itemBody"><h3>'+escapeHtml(item.title)+'</h3><div class="price">'+price+'</div><small>'+escapeHtml(item.category||'')+' · '+escapeHtml(item.city||'')+'</small><button type="button" class="detailsBtn">عرض الإعلان</button></div>';
    card.querySelector('.detailsBtn').onclick=()=>showListingDetails(item);card.querySelector('img')?.addEventListener('click',()=>openImageViewer(img,item.title));addFavoriteControl(card,item);box.appendChild(card);
  });if(!box.children.length)box.innerHTML='<div class="empty">لا توجد إعلانات منشورة ضمن المفضلة حاليًا.</div>';
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
  await loadFavoriteIds();
  await checkAdmin();
  supabaseClient.auth.onAuthStateChange(async(_event,session)=>{
    updateAuthUI(session);
    await loadFavoriteIds();
    await checkAdmin();
    if(!$('favoritesSection')?.hasAttribute('hidden'))await loadMyFavorites();
  });
  await loadListings();
  await loadFeaturedListings();
  await loadCuratedListings();
  await loadTodayListings();
  await loadPopularListings();
}

async function loadListings(){
  const grid=$('listingGrid');
  if(!supabaseClient)return;
  grid.innerHTML='<div class="empty">جاري تحميل الإعلانات...</div>';
  let q=supabaseClient.from('listings')
    .select('id,title,description,price,city,phone,category,image_url,image_urls,condition,status,created_at,seller_id,views_count')
    .eq('status','approved')
    .limit(40);
  const term=$('searchInput').value.trim(),cat=$('categoryFilter').value;
  const city=$('cityFilter').value.trim(),condition=$('conditionFilter').value;
  const minPrice=$('minPriceFilter').value,maxPrice=$('maxPriceFilter').value;
  if(minPrice!==''&&maxPrice!==''&&Number(minPrice)>Number(maxPrice)){
    grid.innerHTML='<div class="empty">السعر الأدنى لا يمكن أن يكون أكبر من السعر الأعلى.</div>';
    return;
  }
  if(term){
    const searchTerm=term
      .replace(/[\\"]/g,'')
      .replace(/[(),]/g,' ')
      .replace(/\s+/g,' ')
      .trim();
    if(searchTerm)q=q.or('title.ilike.%'+searchTerm+'%,description.ilike.%'+searchTerm+'%');
  }
  if(cat)q=q.eq('category',cat);
  if(city)q=q.ilike('city',`%${city}%`);
  if(condition)q=q.eq('condition',condition);
  if(minPrice!=='')q=q.gte('price',Number(minPrice));
  if(maxPrice!=='')q=q.lte('price',Number(maxPrice));
  const sort=$('sortFilter')?.value||'newest';
  if(sort==='price_asc')q=q.order('price',{ascending:true,nullsFirst:false}).order('created_at',{ascending:false});
  else if(sort==='price_desc')q=q.order('price',{ascending:false,nullsFirst:false}).order('created_at',{ascending:false});
  else if(sort==='views_desc')q=q.order('views_count',{ascending:false,nullsFirst:false}).order('created_at',{ascending:false});
  else q=q.order('created_at',{ascending:false});
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
    addFavoriteControl(card,x);
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
    addFavoriteControl(card,x);
    card.querySelector('img')?.addEventListener('click',()=>openImageViewer(img,x.title));
    if(card.querySelector('img'))card.querySelector('img').style.cursor='zoom-in';

    grid.appendChild(card);
  });
}
async function loadCuratedListings(){
  const grid=$('curatedGrid');
  if(!grid||!supabaseClient)return;
  grid.innerHTML='<div class="empty">جاري تجهيز اختياراتنا...</div>';
  const {data,error}=await supabaseClient.from('listings')
    .select('id,title,description,price,city,phone,category,image_url,image_urls,condition,status,created_at,seller_id,views_count')
    .eq('status','approved')
    .order('views_count',{ascending:false})
    .order('created_at',{ascending:false})
    .limit(30);
  if(error){grid.innerHTML='<div class="empty">تعذر تحميل الترشيحات حاليًا.</div>';console.error(error);return;}
  const ranked=(data||[]).map(x=>{
    const images=Array.isArray(x.image_urls)&&x.image_urls.length?x.image_urls:(x.image_url?[x.image_url]:[]);
    const description=String(x.description||'').trim();
    const score=(images.length?3:0)+(images.length>1?1:0)+(description.length>=80?2:description.length>=30?1:0)+(Number(x.price)>0?1:0)+(Number(x.views_count)>0?Math.min(2,Math.log10(Number(x.views_count)+1)):0);
    return {...x,_score:score};
  }).filter(x=>x._score>=4).sort((a,b)=>b._score-a._score).slice(0,4);
  grid.innerHTML='';
  if(!ranked.length){grid.innerHTML='<div class="empty">لسه بنجهز أول ترشيحاتنا. أضف صورًا واضحة وتفاصيل كاملة لإعلانك ليظهر هنا.</div>';return;}
  ranked.forEach(x=>{
    const card=document.createElement('article');card.className='item';
    const img=x.image_url||'';
    const imageCount=Array.isArray(x.image_urls)&&x.image_urls.length?x.image_urls.length:(img?1:0);
    const conditionLabel=x.condition==='new'?'جديد':x.condition==='used'?'مستعمل':'';
    const price=Number(x.price)>0?Number(x.price).toLocaleString('ar-EG')+' جنيه':'السعر عند التواصل';
    const photo=img?'<img src="'+escapeHtml(img)+'" alt="'+escapeHtml(x.title)+'" loading="lazy">':'<div class="listingPhotoEmpty"></div>';
    const count=imageCount>1?'<span class="photoCount">＋'+(imageCount-1)+' صور</span>':'';
    const condition=conditionLabel?'<span class="conditionTag">'+conditionLabel+'</span>':'';
    card.innerHTML='<div class="listingPhotoWrap">'+photo+count+condition+'<span class="curatedTag">اختيار مميز</span></div><div class="itemBody"><h3>'+escapeHtml(x.title)+'</h3><div class="price">'+price+'</div><p>'+escapeHtml(x.description||'')+'</p><small>'+escapeHtml(x.category||'')+' · '+escapeHtml(x.city||'')+'</small><button type="button" class="detailsBtn">اكتشف الإعلان</button></div>';
    card.querySelector('.detailsBtn').onclick=()=>showListingDetails(x);
    addFavoriteControl(card,x);
    card.querySelector('img')?.addEventListener('click',()=>openImageViewer(img,x.title));
    if(card.querySelector('img'))card.querySelector('img').style.cursor='zoom-in';
    grid.appendChild(card);
  });
}
async function loadTodayListings(){
  const grid=$('todayGrid');
  if(!grid||!supabaseClient)return;
  grid.innerHTML='<div class="empty">جاري تحميل إعلانات اليوم...</div>';
  const start=new Date(); start.setHours(0,0,0,0);
  const {data,error}=await supabaseClient.from('listings')
    .select('id,title,description,price,city,phone,category,image_url,image_urls,condition,status,created_at,seller_id')
    .eq('status','approved').gte('created_at',start.toISOString())
    .order('created_at',{ascending:false}).limit(6);
  if(error){grid.innerHTML='<div class="empty">تعذر تحميل إعلانات اليوم حاليًا.</div>';console.error(error);return;}
  grid.innerHTML='';
  if(!data?.length){grid.innerHTML='<div class="empty">لسه مفيش إعلانات جديدة منشورة اليوم. ارجع قريبًا أو تصفح أحدث الإعلانات.</div>';return;}
  data.forEach(x=>{
    const card=document.createElement('article'); card.className='item';
    const img=x.image_url||'';
    const imageCount=Array.isArray(x.image_urls)&&x.image_urls.length?x.image_urls.length:(img?1:0);
    const conditionLabel=x.condition==='new'?'جديد':x.condition==='used'?'مستعمل':'';
    const price=Number(x.price)>0?Number(x.price).toLocaleString('ar-EG')+' جنيه':'السعر عند التواصل';
    const photo=img?'<img src="'+escapeHtml(img)+'" alt="'+escapeHtml(x.title)+'" loading="lazy">':'<div class="listingPhotoEmpty"></div>';
    const count=imageCount>1?'<span class="photoCount">＋'+(imageCount-1)+' صور</span>':'';
    const condition=conditionLabel?'<span class="conditionTag">'+conditionLabel+'</span>':'';
    card.innerHTML='<div class="listingPhotoWrap">'+photo+count+condition+'<span class="todayTag">اليوم</span></div><div class="itemBody"><h3>'+escapeHtml(x.title)+'</h3><div class="price">'+price+'</div><p>'+escapeHtml(x.description||'')+'</p><small>'+escapeHtml(x.category||'')+' · '+escapeHtml(x.city||'')+'</small><button type="button" class="detailsBtn">عرض التفاصيل</button></div>';
    card.querySelector('.detailsBtn').onclick=()=>showListingDetails(x);
    addFavoriteControl(card,x);
    card.querySelector('img')?.addEventListener('click',()=>openImageViewer(img,x.title));
    if(card.querySelector('img'))card.querySelector('img').style.cursor='zoom-in';
    grid.appendChild(card);
  });
}
async function loadPopularListings(){
  const grid=$('popularGrid');
  if(!grid||!supabaseClient)return;
  grid.innerHTML='<div class="empty">جاري تحميل الأكثر مشاهدة...</div>';
  const {data,error}=await supabaseClient.from('listings')
    .select('id,title,description,price,city,category,image_url,image_urls,condition,status,created_at,seller_id,views_count')
    .eq('status','approved').gt('views_count',0)
    .order('views_count',{ascending:false}).order('created_at',{ascending:false}).limit(6);
  if(error){grid.innerHTML='<div class="empty">تعذر تحميل الأكثر مشاهدة حاليًا.</div>';console.error(error);return;}
  grid.innerHTML='';
  if(!data?.length){grid.innerHTML='<div class="empty">قريبًا ستظهر هنا الإعلانات الأكثر مشاهدة بعد تسجيل زيارات حقيقية.</div>';return;}
  data.forEach(x=>{
    const card=document.createElement('article');card.className='item';
    const img=x.image_url||'';
    const imageCount=Array.isArray(x.image_urls)&&x.image_urls.length?x.image_urls.length:(img?1:0);
    const conditionLabel=x.condition==='new'?'جديد':x.condition==='used'?'مستعمل':'';
    const price=Number(x.price)>0?Number(x.price).toLocaleString('ar-EG')+' جنيه':'السعر عند التواصل';
    const photo=img?'<img src="'+escapeHtml(img)+'" alt="'+escapeHtml(x.title)+'" loading="lazy">':'<div class="listingPhotoEmpty"></div>';
    const count=imageCount>1?'<span class="photoCount">＋'+(imageCount-1)+' صور</span>':'';
    const condition=conditionLabel?'<span class="conditionTag">'+conditionLabel+'</span>':'';
    card.innerHTML='<div class="listingPhotoWrap">'+photo+count+condition+'<span class="popularViewCount">◉ '+Number(x.views_count).toLocaleString('ar-EG')+' مشاهدة</span></div><div class="itemBody"><h3>'+escapeHtml(x.title)+'</h3><div class="price">'+price+'</div><p>'+escapeHtml(x.description||'')+'</p><small>'+escapeHtml(x.category||'')+' · '+escapeHtml(x.city||'')+'</small><button type="button" class="detailsBtn">عرض التفاصيل</button></div>';
    card.querySelector('.detailsBtn').onclick=()=>showListingDetails(x);
    addFavoriteControl(card,x);
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

$('favoritesTop').onclick=async()=>{
  if(!currentSession?.user){$('authDialog').showModal();return}
  const section=$('favoritesSection');
  section.removeAttribute('hidden');
  section.scrollIntoView({behavior:'smooth'});
  await loadMyFavorites();
};
$('favoritesRefresh').onclick=loadMyFavorites;

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
$('clearSearchBtn').onclick=()=>{
  $('searchInput').value='';
  $('categoryFilter').value='';
  $('cityFilter').value='';
  $('minPriceFilter').value='';
  $('maxPriceFilter').value='';
  $('conditionFilter').value='';
  $('sortFilter').value='newest';
  loadListings();
};
['searchInput','cityFilter','minPriceFilter','maxPriceFilter'].forEach(id=>{
  $(id).addEventListener('keydown',event=>{if(event.key==='Enter')loadListings();});
});
$('conditionFilter').addEventListener('change',loadListings);
$('sortFilter').addEventListener('change',loadListings);
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
      await loadFavoriteIds();
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
