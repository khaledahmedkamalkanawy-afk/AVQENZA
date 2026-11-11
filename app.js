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
function showListingDetails(x){
  let dialog=$('listingDetailsDialog');
  if(!dialog){
    dialog=document.createElement('dialog');
    dialog.id='listingDetailsDialog';
    dialog.style.cssText='width:min(92%,650px);max-height:90vh;overflow:auto;border:0;border-radius:16px;padding:22px;background:#fff;color:#172033;box-shadow:0 15px 50px #0005';
    document.body.appendChild(dialog);
  }

  const phone=String(x.phone||'').replace(/[^0-9+]/g,'');
  const wa=phone.replace(/^\+/,'').replace(/^0/,'20');
  const price=Number(x.price)>0?Number(x.price).toLocaleString('ar-EG')+' جنيه':'السعر عند التواصل';
  const images=x.image_urls?.length ? x.image_urls : (x.image_url ? [x.image_url] : []);
const image=images.map((url,i)=>`
  <img src="${escapeHtml(url)}" alt="${escapeHtml(x.title)}" style="width:100%;max-height:320px;object-fit:contain;border-radius:12px;background:#f1f3f6;margin-bottom:8px;cursor:zoom-in" data-image-index="${i}">
`).join('');
  const contact=phone
    ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px"><a href="tel:${escapeHtml(phone)}" style="display:inline-block;padding:12px 20px;background:#1769aa;color:white;text-decoration:none;border-radius:9px">اتصال بالبائع</a><a href="https://wa.me/${escapeHtml(wa)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 20px;background:#16834a;color:white;text-decoration:none;border-radius:9px">واتساب</a></div>`
    : '<p>لا يوجد رقم تواصل معلن.</p>';

  dialog.innerHTML=`
    <button type="button" id="closeListingDetails" style="float:left;border:0;background:#eee;border-radius:8px;padding:8px 13px;font-size:18px">✕</button>
    ${image}
    <h2 style="margin:18px 0 8px">${escapeHtml(x.title)}</h2>
    <div style="font-size:22px;font-weight:bold;color:#1769aa;margin-bottom:12px">${price}</div>
    <p style="line-height:1.9;white-space:pre-wrap">${escapeHtml(x.description||'لا يوجد وصف إضافي.')}</p>
    <p style="color:#667085">${escapeHtml(x.category||'')} · ${escapeHtml(x.city||'')}</p>
    ${contact}
  `;
  $('closeListingDetails').onclick=()=>dialog.close();
  dialog.querySelectorAll('img[data-image-index]').forEach(img=>{
  img.addEventListener('click',()=>{
    const index=Number(img.dataset.imageIndex);
    openImageViewer(images[index],x.title);
  });
});
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
}

async function loadListings(){
  const grid=$('listingGrid');
  if(!supabaseClient)return;
  grid.innerHTML='<div class="empty">جاري تحميل الإعلانات...</div>';
  let q=supabaseClient.from('listings')
    .select('id,title,description,price,city,phone,category,image_url,image_urls,status,created_at')
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
    const price=Number(x.price)>0?Number(x.price).toLocaleString('ar-EG')+' جنيه':'السعر عند التواصل';
    const phone=String(x.phone||'').replace(/[^0-9+]/g,'');
    const wa=phone.replace(/^\+/,'').replace(/^0/,'20');

    card.innerHTML=`
      ${img?`<img src="${escapeHtml(img)}" alt="${escapeHtml(x.title)}" loading="lazy">`:'<div style="height:180px;background:#26364a"></div>'}
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
    .select('id,title,description,price,city,phone,category,image_url,image_urls,status')
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
  const title=prompt('عنوان الإعلان:',x.title);
  if(title===null)return;
  const description=prompt('وصف الإعلان:',x.description||'');
  if(description===null)return;
  const price=prompt('السعر:',x.price||0);
  if(price===null)return;
  const phone=prompt('رقم الهاتف:',x.phone||'');
  if(phone===null)return;
  const city=prompt('المدينة:',x.city||'');
  if(city===null)return;

  if(title.trim().length<4||!description.trim()||!Number.isFinite(Number(price))||Number(price)<0){
    toast('راجع البيانات وحاول مرة أخرى.');
    return;
  }

  const {data:{user},error:ue}=await supabaseClient.auth.getUser();
  if(ue||!user){toast('سجل الدخول أولًا.');return}

  const fileInput=document.createElement('input');
  fileInput.type='file';
  fileInput.accept='image/jpeg,image/png,image/webp';

    fileInput.style.display='block';
  fileInput.style.margin='15px auto';
  document.body.appendChild(fileInput);

  const file=await new Promise(resolve=>{
    fileInput.onchange=()=>{
      const selected=fileInput.files?.[0]||null;
      fileInput.remove();
      resolve(selected);
    };
  });

  let imageUrl=x.image_url;

  if(file){
    if(file.size>5*1024*1024){
      toast('حجم الصورة يجب ألا يتجاوز 5 ميجابايت.');
      return;
    }

    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
      toast('اختر صورة JPG أو PNG أو WebP.');
      return;
    }

    const path=`${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    const up=await supabaseClient.storage.from('listing-images').upload(path,file);

    if(up.error){
      toast('تعذر رفع الصورة: '+up.error.message);
      return;
    }

    imageUrl=supabaseClient.storage.from('listing-images').getPublicUrl(path).data.publicUrl;
  }

  const {error}=await supabaseClient.from('listings').update({
    title:title.trim(),
    description:description.trim(),
    price:Number(price),
    phone:phone.trim(),
    city:city.trim(),
    image_url:imageUrl,
    status:'pending'
  }).eq('id',x.id).eq('seller_id',user.id);

  if(error){
    toast('تعذر تعديل الإعلان: '+error.message);
    return;
  }

  toast('تم التعديل، والإعلان بانتظار المراجعة.');
  await loadMyListings();
  await loadListings();
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
    loadPendingListings()
  ]);
}

async function loadAdminAllListings(){
  const box=$('adminAllListings');
  box.innerHTML='<div class="empty">جاري تحميل الإعلانات...</div>';

  const {data,error}=await supabaseClient.from('listings')
    .select('id,title,price,city,category,status,created_at')
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
        ${x.status==='pending'?`
          <button data-action="approved">اعتماد الإعلان</button>
          <button class="outline" data-action="rejected">رفض الإعلان</button>
        `:''}
      </div>`;

    el.querySelectorAll('button[data-action]').forEach(btn=>{
      btn.onclick=()=>moderateListing(x.id,btn.dataset.action);
    });
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
  const email=$('authEmail').value.trim(),password=$('authPassword').value;
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

  let imageUrl=null;
  const f=$('adImage').files?.[0];
  if(f){
    if(f.size>5*1024*1024){msg.textContent='حجم الصورة يجب ألا يتجاوز 5 ميجابايت.';return}
    if(!['image/jpeg','image/png','image/webp'].includes(f.type)){msg.textContent='الصورة يجب أن تكون JPG أو PNG أو WebP.';return}
    const path=`${user.id}/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    const up=await supabaseClient.storage.from('listing-images').upload(path,f);
    if(up.error){msg.textContent='تعذر رفع الصورة: '+up.error.message;return}
    imageUrl=supabaseClient.storage.from('listing-images').getPublicUrl(path).data.publicUrl;
  }

  const payload={seller_id:user.id,title,description,price:priceRaw?Number(priceRaw):0,category,city,phone,image_url:imageUrl,status:'pending'};
  const {error:le}=await supabaseClient.from('listings').insert(payload);
  if(le){
    if(f){
      const path=imageUrl?.split('/listing-images/')[1];
      if(path)await supabaseClient.storage.from('listing-images').remove([decodeURIComponent(path)]);
    }
    msg.textContent='تعذر حفظ الإعلان: '+le.message;
    return;
  }
  msg.textContent='تم إرسال إعلانك للمراجعة قبل النشر.';
  $('adDialog').close();
  toast('تم استلام إعلانك للمراجعة.');
  await loadListings();
};

init();
