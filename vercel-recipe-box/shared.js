// shared.js — storage, rendering, and utility helpers shared by index.html and admin.html
const $ = (id) => document.getElementById(id);

function showToast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(()=>{ t.style.opacity='0'; }, 2400);
}

function showConnBanner(show){
  const b = $('conn-banner');
  if(!b) return;
  b.classList.toggle('show', show);
}

// storageGet distinguishes "connection/request failed" (ok:false) from
// "key genuinely does not exist" (ok:true, value:null) so callers can
// show a connection-failure banner instead of silently rendering an
// empty-recipes state.
async function storageGet(key){
  try{
    const r = await fetch('/api/kv?key=' + encodeURIComponent(key));
    if(r.status === 404) return { ok:true, value:null };
    if(!r.ok) return { ok:false, value:null };
    const data = await r.json();
    return { ok:true, value:data.value };
  }catch(e){ return { ok:false, value:null }; }
}
async function storageSet(key, value){
  try{
    const r = await fetch('/api/kv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value })
    });
    return r.ok;
  }catch(e){ return false; }
}
async function storageDelete(key){
  try{
    await fetch('/api/kv?key=' + encodeURIComponent(key), { method: 'DELETE' });
  }catch(e){}
}

function escapeHtml(s){
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}
function escapeAttr(s){ return (s||'').replace(/"/g,'&quot;'); }
function isUrl(s){ return /^https?:\/\//i.test(s); }

function timeTabClass(mins){
  if(!mins) return 'tab-mid';
  if(mins <= 15) return 'tab-fast';
  if(mins <= 40) return 'tab-mid';
  return 'tab-long';
}

function buildGridHtml(list){
  return list.map(r => `
    <div class="rcard ${timeTabClass(r.cookTime)}" data-id="${r.id}">
      ${r.thumb
        ? `<img class="rcard-photo" src="${r.thumb}" alt="">`
        : `<div class="rcard-photo placeholder">사진 없음</div>`}
      <div class="rcard-body">
        <p class="rcard-title">${escapeHtml(r.title)}</p>
        <div class="rcard-meta">⏱ ${r.cookTime ? r.cookTime+'분' : '-'}</div>
      </div>
    </div>
  `).join('');
}

function wireGridClicks(gridEl, onClick){
  gridEl.querySelectorAll('.rcard').forEach(el=>{
    el.addEventListener('click', ()=> onClick(el.dataset.id));
  });
}

function linkifyLine(line){
  const escaped = escapeHtml(line);
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, url => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
}

function renderPlaceBox(place){
  const lines = (place || '').split('\n').map(l => l.trim()).filter(Boolean);
  if(!lines.length) return '';
  return `<div class="source-box">🛒 구매처<br>${lines.map(linkifyLine).join('<br>')}</div>`;
}

function stepText(s){ return typeof s === 'string' ? s : (s.text || ''); }
function stepPhoto(s){ return typeof s === 'string' ? null : (s.photo || null); }

function renderStepCarousel(r){
  const steps = r.steps || [];
  if(!steps.length){
    return `
      <div class="detail-photo-wrap">
        ${r.photo ? `<img class="detail-photo" src="${r.photo}">` : `<div class="detail-photo step-photo-empty">사진 없음</div>`}
        <div class="stamp"><span>성공</span><span>APPROVED</span></div>
      </div>
    `;
  }
  const slidesHtml = steps.map((s,i) => `
    <div class="step-slide">
      ${stepPhoto(s) ? `<img class="detail-photo" src="${stepPhoto(s)}">` : `<div class="detail-photo step-photo-empty">사진 없음</div>`}
      <div class="step-slide-text"><span class="step-slide-num">${i+1}</span>${escapeHtml(stepText(s))}</div>
    </div>
  `).join('');
  const dotsHtml = steps.map((_,i) => `<span class="dot${i===0 ? ' active' : ''}"></span>`).join('');
  return `
    <div class="step-carousel-wrap">
      <div class="stamp carousel-stamp"><span>성공</span><span>APPROVED</span></div>
      <div class="step-carousel" id="step-carousel">${slidesHtml}</div>
      <div class="carousel-dots" id="carousel-dots">${dotsHtml}</div>
    </div>
  `;
}

function wireCarouselDots(){
  const carousel = $('step-carousel');
  const dotsWrap = $('carousel-dots');
  if(!carousel || !dotsWrap) return;
  const dots = dotsWrap.querySelectorAll('.dot');
  carousel.addEventListener('scroll', ()=>{
    const idx = Math.round(carousel.scrollLeft / carousel.clientWidth);
    dots.forEach((d,i)=> d.classList.toggle('active', i===idx));
  });
}

function renderDetailCore(r){
  const ingredientsHtml = (r.ingredients||[]).map(ing => `
    <li><span>${escapeHtml(ing.name)}</span><span class="amt">${escapeHtml(ing.amount||'')}</span></li>
  `).join('') || '<li style="color:var(--ink-soft)">등록된 재료가 없어요</li>';
  const stepsHtml = (r.steps||[]).map((s,i) => `
    <li class="step-item"><div class="step-num">${i+1}</div><div class="step-text">${escapeHtml(stepText(s))}</div></li>
  `).join('') || '<li style="color:var(--ink-soft)">등록된 단계가 없어요</li>';

  return `
    ${renderStepCarousel(r)}
    <h3 class="detail-title">${escapeHtml(r.title)}</h3>
    <div class="detail-meta-row">
      <div class="meta-chip">⏱ ${r.cookTime ? r.cookTime+'분' : '시간 미정'}</div>
    </div>
    <div class="section-label">재료</div>
    <ul class="ingredient-list">${ingredientsHtml}</ul>
    <div class="section-label">만드는 법</div>
    <ul class="step-list">${stepsHtml}</ul>
    ${r.source ? `<div class="source-box">📎 출처: ${isUrl(r.source) ? `<a href="${escapeHtml(r.source)}" target="_blank" rel="noopener">${escapeHtml(r.source)}</a>` : escapeHtml(r.source)}</div>` : ''}
    ${r.tips ? `<div class="tips-box">💡 Tips: ${escapeHtml(r.tips)}</div>` : ''}
    ${renderPlaceBox(r.place)}
  `;
}

function fmtTime(ts){
  if(!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  if(sameDay) return `오늘 ${hh}:${mm}`;
  return `${d.getMonth()+1}/${d.getDate()} ${hh}:${mm}`;
}

function buildCommentsHtml(comments, showDelete){
  if(!comments || comments.length === 0){
    return '<div class="empty-mini">아직 댓글이 없어요.</div>';
  }
  return comments.map(c => `
    <div class="comment-item" data-comment-id="${c.id}">
      <div class="comment-head">
        <span class="comment-name">${escapeHtml(c.name || '익명')}</span>
        <span class="comment-time">${fmtTime(c.createdAt)}</span>
        ${showDelete ? `<button class="comment-delete" data-comment-id="${c.id}" type="button">✕</button>` : ''}
      </div>
      <div class="comment-text">${escapeHtml(c.text)}</div>
    </div>
  `).join('');
}

function compressImage(file, maxWidth, quality){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = (e)=>{
      const img = new Image();
      img.onload = ()=>{
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
