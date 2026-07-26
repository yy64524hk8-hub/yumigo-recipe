# 레시피 상자 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single gated `index.html` into a public, gate-free viewing page and a password-protected `/admin` page for recipe CRUD, and fix the bug where storage-connection failures were indistinguishable from "no recipes."

**Architecture:** Two static HTML pages (`index.html`, `admin.html`) share common logic (`shared.js`) and styles (`shared.css`). Both talk to the existing `api/kv.js` serverless function backed by Vercel KV. A `vercel.json` rewrite exposes `admin.html` at `/admin`.

**Tech Stack:** Vanilla HTML/CSS/JS (no framework, no build step), Vercel KV via `@vercel/kv`, Vercel serverless functions.

## Global Constraints

- `index.html` shows the recipe grid and detail view immediately on load, with no login/approval gate (per spec 범위, 공개 페이지 동작)
- `index.html` contains zero admin login UI, links, or hidden entry points to `/admin` (per spec 공개 페이지 동작)
- The only interactions available on `index.html` are: search the recipe list, and select a recipe to view its detail (per spec 공개 페이지 동작)
- Recipe add/edit/delete is possible only from `admin.html`, gated by `site-passcode` (per spec 범위, 관리자 페이지 동작)
- `admin.html` is reachable at `/admin` via a `vercel.json` rewrite (per spec 아키텍처)
- `storageGet` must return `{ok, value}`: `ok:false` on any fetch/network/non-404 HTTP failure, `ok:true, value:null` only when the key genuinely does not exist (404). Callers must show a persistent connection-failure banner when `ok:false`, and must NOT render an empty-recipes state in that case (per spec 저장소 연결 실패 처리)
- `join-requests` and `invite-codes` logic and UI (request/waiting/denied/invite panels, admin request-approval panel, invite code generator) are fully removed from both pages (per spec 데이터 모델, 관리자 페이지 동작)
- The existing `yumigos-recipe` Vercel project and its connected KV database are reused — redeploys must use `vercel --prod` only, never plain `vercel` (per spec 배포)
- No test framework is available in this environment (no Node.js installed). Verification for each task is: (a) the implementer traces the logic by hand and documents it in self-review, and (b) `grep`-based structural checks confirming required markup/identifiers are present in the right file and absent from the wrong one. Do not claim "tests passing" — there is no test runner; report grep check results and hand-traced logic instead.

---

## File Structure

```
vercel-recipe-box/
├── index.html       # Public, gate-free viewing page (rewritten)
├── admin.html         # New: password-gated CRUD page, served at /admin
├── shared.css          # New: styles extracted from the old index.html <style> block
├── shared.js            # New: storage helpers + shared rendering functions
├── vercel.json           # New: /admin -> admin.html rewrite
├── api/kv.js               # Unchanged
└── 배포방법.md              # Updated: vercel --prod only, /admin URL, existing-project relink instructions
```

---

### Task 1: `shared.css`

**Files:**
- Create: `shared.css`
- Modify: `index.html` (swap inline `<style>` for `<link rel="stylesheet" href="shared.css">` — full rewrite happens in Task 3, so for this task just leave `index.html` otherwise untouched)

**Interfaces:**
- Produces: a stylesheet providing every CSS class both `index.html` (Task 3) and `admin.html` (Task 4) will reference: `.gate-*`, `#main-screen`, `.topbar*`, `.icon-btn`, `.search-row`, `.empty-state`, `.grid`, `.rcard*`, `.fab`, `.overlay`, `.sheet*`, `.detail-*`, `.section-label`, `.ingredient-list`, `.step-list`, `.step-item`, `.step-num`, `.step-text`, `.source-box`, `.btn*`, `.field*`, `.photo-upload*`, `.row2`, `.row-step`, `.row-x`, `.add-row-btn`, `.form-footer`, `.toast`, and a new `.conn-banner`.

The current `vercel-recipe-box/index.html` has a `<style>` block (opens right after the Google Fonts `<link>` tags, closes right before `<body>`). Read it directly from the repo — it is the verbatim source for this extraction.

- [ ] **Step 1: Copy the style block into shared.css, minus the panels this project removes**

Copy the full contents between `<style>` and `</style>` in the current `index.html` into a new file `shared.css` (no `<style>` tags — just the CSS rules), then delete these rules from the copy (they belong only to the join-request/invite-code system this version removes):

- `.waiting-wrap`, `.spinner`, `@keyframes spin`, `.waiting-name` (under the `/* ---------- GATE ---------- */` comment block)
- `.badge-dot` (under the `/* ---------- HEADER ---------- */` comment block)
- The entire `/* ---------- ADMIN PANEL ---------- */` comment block and everything under it: `.admin-section-title`, `.admin-section-title:first-child`, `.admin-sub`, `.req-item`, `.req-item:last-child`, `.req-name`, `.req-time`, `.req-actions`, `.mini-btn`, `.mini-btn.allow`, `.mini-btn.deny`, `.status-pill`, `.status-pill.approved`, `.status-pill.denied`, `.invite-row`, `.invite-row input`, `.invite-chip`, `.invite-code-text`, `.invite-label`, `.invite-actions`, `.empty-mini`

Keep every other rule byte-for-byte identical (including the `:root` custom properties, resets, gate-card/gate-input/gate-btn rules used by the simplified admin login, and all grid/detail/form/toast rules).

- [ ] **Step 2: Append the connection-failure banner style**

Add this new rule at the end of `shared.css`:

```css
.conn-banner{
  background:var(--plum); color:#fff; text-align:center; font-size:13px;
  padding:10px 16px; border-radius:10px; margin-bottom:16px; display:none;
}
.conn-banner.show{display:block;}
```

- [ ] **Step 3: Verify removed rules are gone and kept rules survived**

Run:
```bash
cd "/Users/yumigo/Documents/AI_Claude/0712/vercel-recipe-box"
grep -c "admin-section-title\|invite-row\|waiting-wrap\|badge-dot\|\.spinner" shared.css
grep -c "conn-banner\|gate-btn\|\.rcard\|\.fab\|photo-upload\|ingredient-list" shared.css
```
Expected: first command outputs `0`, second command outputs a number greater than `0` for each pattern (run individually if you want per-pattern counts).

- [ ] **Step 4: Commit**

```bash
git add shared.css
git commit -m "feat: extract shared.css, drop join-request/invite styles, add conn-banner"
```

---

### Task 2: `shared.js`

**Files:**
- Create: `shared.js`

**Interfaces:**
- Produces (all plain global functions, loaded via `<script src="shared.js"></script>` before each page's own inline script — no module system, matching the codebase's existing plain-script style):
  - `$(id) -> HTMLElement`
  - `showToast(msg: string) -> void`
  - `showConnBanner(show: boolean) -> void` (toggles `#conn-banner`'s `.show` class — both `index.html` and `admin.html` must include an element with `id="conn-banner"` for this to work)
  - `async storageGet(key: string) -> {ok: boolean, value: string|null}`
  - `async storageSet(key: string, value: string) -> boolean`
  - `async storageDelete(key: string) -> void`
  - `escapeHtml(s: string) -> string`, `escapeAttr(s: string) -> string`, `isUrl(s: string) -> boolean`
  - `timeTabClass(mins: number|null) -> string`
  - `buildGridHtml(list: Array<{id,title,cookTime,thumb}>) -> string` (HTML for the recipe grid, no click listeners wired)
  - `wireGridClicks(gridEl: HTMLElement, onClick: (id:string)=>void) -> void`
  - `renderDetailCore(r: {title,cookTime,ingredients,steps,source,photo}) -> string` (detail HTML WITHOUT action buttons — callers that need edit/delete buttons append their own markup after this)
  - `compressImage(file: File, maxWidth: number, quality: number) -> Promise<string>` (data URL)
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write shared.js**

Create `shared.js`:

```js
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

function renderDetailCore(r){
  const ingredientsHtml = (r.ingredients||[]).map(ing => `
    <li><span>${escapeHtml(ing.name)}</span><span class="amt">${escapeHtml(ing.amount||'')}</span></li>
  `).join('') || '<li style="color:var(--ink-soft)">등록된 재료가 없어요</li>';
  const stepsHtml = (r.steps||[]).map((s,i) => `
    <li class="step-item"><div class="step-num">${i+1}</div><div class="step-text">${escapeHtml(s)}</div></li>
  `).join('') || '<li style="color:var(--ink-soft)">등록된 단계가 없어요</li>';

  return `
    <div class="detail-photo-wrap">
      ${r.photo ? `<img class="detail-photo" src="${r.photo}">` : `<div class="detail-photo" style="display:flex;align-items:center;justify-content:center;color:var(--ink-soft);">사진 없음</div>`}
      <div class="stamp"><span>성공</span><span>APPROVED</span></div>
    </div>
    <h3 class="detail-title">${escapeHtml(r.title)}</h3>
    <div class="detail-meta-row">
      <div class="meta-chip">⏱ ${r.cookTime ? r.cookTime+'분' : '시간 미정'}</div>
    </div>
    <div class="section-label">재료</div>
    <ul class="ingredient-list">${ingredientsHtml}</ul>
    <div class="section-label">만드는 법</div>
    <ul class="step-list">${stepsHtml}</ul>
    ${r.source ? `<div class="source-box">📎 출처: ${isUrl(r.source) ? `<a href="${escapeHtml(r.source)}" target="_blank" rel="noopener">${escapeHtml(r.source)}</a>` : escapeHtml(r.source)}</div>` : ''}
  `;
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
```

- [ ] **Step 2: Hand-trace the storageGet fix and document it**

Since there is no test runner in this environment, trace these four cases against the code above and write the results into your report (this is the exact bug the whole project exists to fix, so be precise):
1. `fetch` resolves with `r.ok === true` → returns `{ok:true, value:data.value}`
2. `fetch` resolves with `r.status === 404` → returns `{ok:true, value:null}` (genuinely missing key, not a failure)
3. `fetch` resolves with `r.ok === false` and `r.status !== 404` (e.g. 500) → returns `{ok:false, value:null}`
4. `fetch` throws (network error) → caught, returns `{ok:false, value:null}`

- [ ] **Step 3: Structural verification**

Run:
```bash
cd "/Users/yumigo/Documents/AI_Claude/0712/vercel-recipe-box"
grep -c "function storageGet\|function storageSet\|function storageDelete\|function buildGridHtml\|function renderDetailCore\|function compressImage\|function showConnBanner" shared.js
```
Expected: `7`

- [ ] **Step 4: Commit**

```bash
git add shared.js
git commit -m "feat: add shared.js with ok/value-aware storage helpers and shared renderers"
```

---

### Task 3: `index.html` — public viewing page

**Files:**
- Modify: `index.html` (full rewrite)

**Interfaces:**
- Consumes from `shared.js` (Task 2): `$`, `showToast`, `showConnBanner`, `storageGet`, `buildGridHtml`, `wireGridClicks`, `renderDetailCore`
- Consumes from `shared.css` (Task 1): all classes referenced in the markup below
- Produces: nothing other tasks depend on directly (Task 7 exercises this page manually)

- [ ] **Step 1: Replace index.html with the gate-free public page**

Replace the entire contents of `index.html` with:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no">
<title>Yumi G's 레시피</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700;9..144,900&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Nanum+Gothic:wght@400;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="shared.css">
</head>
<body>

<div id="toast" class="toast"></div>

<div id="main-screen">
  <div class="topbar">
    <div>
      <span class="eyebrow">TESTED &amp; APPROVED</span>
      <h1>Yumi G's 레시피</h1>
    </div>
  </div>
  <div id="conn-banner" class="conn-banner">저장소 연결에 실패했어요. 새로고침 해보세요.</div>
  <div class="search-row">
    <input id="search-input" type="text" placeholder="레시피 이름으로 찾기...">
  </div>
  <div id="grid" class="grid"></div>
  <div id="empty-state" class="empty-state hidden">
    <span class="serif">아직 레시피가 없어요</span>
  </div>
</div>

<div id="detail-overlay" class="overlay hidden">
  <div class="sheet">
    <div class="sheet-header">
      <h2>레시피</h2>
      <button class="close-x" id="detail-close">✕</button>
    </div>
    <div class="sheet-body" id="detail-body"></div>
  </div>
</div>

<script src="shared.js"></script>
<script>
(function(){
  "use strict";

  let recipeIndex = [];

  async function loadIndexAndRender(){
    const res = await storageGet('recipe-index');
    if(!res.ok){
      showConnBanner(true);
      return;
    }
    showConnBanner(false);
    recipeIndex = res.value ? JSON.parse(res.value) : [];
    recipeIndex.sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));
    renderGrid();
  }

  function renderGrid(){
    const q = ($('search-input').value || '').trim().toLowerCase();
    const list = q ? recipeIndex.filter(r => r.title.toLowerCase().includes(q)) : recipeIndex;
    const grid = $('grid');
    if(list.length === 0){
      grid.innerHTML = '';
      $('empty-state').classList.toggle('hidden', recipeIndex.length !== 0);
      if(recipeIndex.length !== 0 && q){
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><span class="serif">검색 결과가 없어요</span></div>';
      }
      return;
    }
    $('empty-state').classList.add('hidden');
    grid.innerHTML = buildGridHtml(list);
    wireGridClicks(grid, openDetail);
  }

  async function openDetail(id){
    const res = await storageGet('recipe:' + id);
    if(!res.ok || !res.value){ showToast('레시피를 불러올 수 없어요.'); return; }
    const r = JSON.parse(res.value);
    $('detail-body').innerHTML = renderDetailCore(r);
    $('detail-overlay').classList.remove('hidden');
  }
  function closeDetail(){ $('detail-overlay').classList.add('hidden'); }

  document.addEventListener('DOMContentLoaded', ()=>{
    loadIndexAndRender();
    $('search-input').addEventListener('input', renderGrid);
    $('detail-close').addEventListener('click', closeDetail);
    $('detail-overlay').addEventListener('click', (e)=>{ if(e.target.id==='detail-overlay') closeDetail(); });
  });
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Structural verification — removed features are absent**

Run:
```bash
cd "/Users/yumigo/Documents/AI_Claude/0712/vercel-recipe-box"
grep -c "gate-screen\|fab-add\|form-overlay\|admin-overlay\|edit-btn\|delete-btn\|site-passcode\|join-requests\|invite-codes" index.html
```
Expected: `0`

- [ ] **Step 3: Structural verification — required features are present**

Run:
```bash
grep -c "conn-banner\|search-input\|detail-overlay\|shared.js\|shared.css" index.html
```
Expected: a count greater than `0` (run individually per pattern if you want exact numbers — every pattern should be present at least once).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: rewrite index.html as a gate-free public viewing page"
```

---

### Task 4: `admin.html` — password-gated CRUD page

**Files:**
- Create: `admin.html`

**Interfaces:**
- Consumes from `shared.js` (Task 2): `$`, `showToast`, `showConnBanner`, `storageGet`, `storageSet`, `storageDelete`, `escapeAttr`, `escapeHtml`, `buildGridHtml`, `wireGridClicks`, `renderDetailCore`, `compressImage`
- Consumes from `shared.css` (Task 1): all classes referenced in the markup below
- Produces: nothing other tasks depend on directly (Task 5's rewrite targets this file's name; Task 7 exercises this page manually)

- [ ] **Step 1: Create admin.html**

Create `admin.html`:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no">
<title>Yumi G's 레시피 — 관리자</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700;9..144,900&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Nanum+Gothic:wght@400;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="shared.css">
</head>
<body>

<div id="toast" class="toast"></div>

<!-- GATE -->
<div id="gate-screen">
  <div class="gate-card">
    <div class="gate-tab">RECIPE BOX ADMIN</div>

    <div id="panel-setup">
      <h1>관리자 처음 설정하기</h1>
      <p>처음 오셨네요! 관리자 비밀번호를 정해주세요.</p>
      <input id="setup-pw" class="gate-input" type="password" placeholder="관리자 비밀번호">
      <input id="setup-pw-confirm" class="gate-input" type="password" placeholder="비밀번호 확인">
      <button class="gate-btn" id="setup-btn">관리자로 시작하기</button>
      <div class="gate-error" id="setup-error"></div>
    </div>

    <div id="panel-admin-login" class="hidden">
      <h1>관리자 로그인</h1>
      <p>관리자 비밀번호를 입력해주세요.</p>
      <input id="admin-pw-input" class="gate-input" type="password" placeholder="관리자 비밀번호">
      <button class="gate-btn" id="admin-login-btn">로그인</button>
      <div class="gate-error" id="admin-login-error"></div>
    </div>
  </div>
</div>

<!-- MAIN -->
<div id="main-screen" class="hidden">
  <div class="topbar">
    <div>
      <span class="eyebrow">ADMIN</span>
      <h1>Yumi G's 레시피</h1>
    </div>
    <div class="topbar-actions">
      <button class="icon-btn" id="settings-btn" title="비밀번호 변경">⚙</button>
    </div>
  </div>
  <div id="conn-banner" class="conn-banner">저장소 연결에 실패했어요. 새로고침 해보세요.</div>
  <div class="search-row">
    <input id="search-input" type="text" placeholder="레시피 이름으로 찾기...">
  </div>
  <div id="grid" class="grid"></div>
  <div id="empty-state" class="empty-state hidden">
    <span class="serif">아직 레시피가 없어요</span>
    <p>오른쪽 아래 + 버튼을 눌러 첫 성공 레시피를 기록해보세요.</p>
  </div>
  <button class="fab" id="fab-add" title="레시피 추가">+</button>
</div>

<!-- DETAIL OVERLAY -->
<div id="detail-overlay" class="overlay hidden">
  <div class="sheet">
    <div class="sheet-header">
      <h2>레시피</h2>
      <button class="close-x" id="detail-close">✕</button>
    </div>
    <div class="sheet-body" id="detail-body"></div>
  </div>
</div>

<!-- FORM OVERLAY -->
<div id="form-overlay" class="overlay hidden">
  <div class="sheet">
    <div class="sheet-header">
      <h2 id="form-title">레시피 추가</h2>
      <button class="close-x" id="form-close">✕</button>
    </div>
    <div class="sheet-body">
      <div class="field">
        <label>사진</label>
        <label class="photo-upload" id="photo-upload-label">
          <div id="photo-preview-wrap">
            <span class="ph-label">📷 탭해서 사진 찍기 / 선택하기</span>
          </div>
          <input type="file" id="photo-input" accept="image/*" capture="environment">
        </label>
      </div>
      <div class="field">
        <label>요리 이름</label>
        <input type="text" id="f-title" placeholder="예: 엄마표 김치찌개">
      </div>
      <div class="field">
        <label>조리 시간 (분)</label>
        <input type="number" id="f-time" placeholder="예: 30" min="1">
      </div>
      <div class="field">
        <label>재료</label>
        <div id="ingredients-rows"></div>
        <button class="add-row-btn" id="add-ingredient">+ 재료 추가</button>
      </div>
      <div class="field">
        <label>만드는 법</label>
        <div id="steps-rows"></div>
        <button class="add-row-btn" id="add-step">+ 단계 추가</button>
      </div>
      <div class="field">
        <label>출처</label>
        <input type="text" id="f-source" placeholder="예: 엄마, 유튜브 채널명, 링크 등">
      </div>
    </div>
    <div class="form-footer">
      <button class="btn" id="form-cancel">취소</button>
      <button class="btn primary" id="form-save">저장</button>
    </div>
  </div>
</div>

<script src="shared.js"></script>
<script>
(function(){
  "use strict";

  let recipeIndex = [];
  let editingId = null;
  let photoFullData = null;
  let photoThumbData = null;
  let ingredientCount = 0;
  let stepCount = 0;

  // ---------- gate ----------
  function showPanel(name){
    ['setup','admin-login'].forEach(p=>{
      $('panel-' + p).classList.toggle('hidden', p !== name);
    });
  }

  async function initGate(){
    const existing = await storageGet('site-passcode');
    if(!existing.ok){ showConnBanner(true); return; }
    showPanel(existing.value ? 'admin-login' : 'setup');
  }

  async function handleSetup(){
    const pw = $('setup-pw').value.trim();
    const confirmPw = $('setup-pw-confirm').value.trim();
    $('setup-error').textContent = '';
    if(pw.length < 2){ $('setup-error').textContent = '2자 이상으로 정해주세요.'; return; }
    if(pw !== confirmPw){ $('setup-error').textContent = '비밀번호가 서로 달라요.'; return; }
    const ok = await storageSet('site-passcode', pw);
    if(!ok){ $('setup-error').textContent = '저장에 실패했어요. 다시 시도해주세요.'; return; }
    showToast('관리자로 설정됐어요.');
    await enterApp();
  }

  async function handleAdminLogin(){
    const pw = $('admin-pw-input').value.trim();
    $('admin-login-error').textContent = '';
    const stored = await storageGet('site-passcode');
    if(!stored.ok){ $('admin-login-error').textContent = '저장소 연결에 실패했어요.'; return; }
    if(pw === stored.value){
      await enterApp();
    }else{
      $('admin-login-error').textContent = '비밀번호가 올바르지 않아요.';
    }
  }

  async function enterApp(){
    $('gate-screen').classList.add('hidden');
    $('main-screen').classList.remove('hidden');
    await loadIndexAndRender();
  }

  // ---------- index / grid ----------
  async function loadIndexAndRender(){
    const res = await storageGet('recipe-index');
    if(!res.ok){ showConnBanner(true); return; }
    showConnBanner(false);
    recipeIndex = res.value ? JSON.parse(res.value) : [];
    recipeIndex.sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));
    renderGrid();
  }

  function renderGrid(){
    const q = ($('search-input').value || '').trim().toLowerCase();
    const list = q ? recipeIndex.filter(r => r.title.toLowerCase().includes(q)) : recipeIndex;
    const grid = $('grid');
    if(list.length === 0){
      grid.innerHTML = '';
      $('empty-state').classList.toggle('hidden', recipeIndex.length !== 0);
      if(recipeIndex.length !== 0 && q){
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><span class="serif">검색 결과가 없어요</span></div>';
      }
      return;
    }
    $('empty-state').classList.add('hidden');
    grid.innerHTML = buildGridHtml(list);
    wireGridClicks(grid, openDetail);
  }

  // ---------- detail ----------
  async function openDetail(id){
    const res = await storageGet('recipe:' + id);
    if(!res.ok || !res.value){ showToast('레시피를 불러올 수 없어요.'); return; }
    const r = JSON.parse(res.value);
    $('detail-body').innerHTML = renderDetailCore(r) + `
      <div class="detail-actions">
        <button class="btn" id="edit-btn">✎ 수정</button>
        <button class="btn danger" id="delete-btn">🗑 삭제</button>
      </div>
    `;
    $('edit-btn').addEventListener('click', ()=>{ closeDetail(); openForm(r); });
    $('delete-btn').addEventListener('click', ()=> deleteRecipe(r.id));
    $('detail-overlay').classList.remove('hidden');
  }
  function closeDetail(){ $('detail-overlay').classList.add('hidden'); }

  async function deleteRecipe(id){
    if(!confirm('이 레시피를 정말 삭제할까요?')) return;
    await storageDelete('recipe:' + id);
    recipeIndex = recipeIndex.filter(r => r.id !== id);
    await storageSet('recipe-index', JSON.stringify(recipeIndex));
    closeDetail();
    renderGrid();
    showToast('삭제했어요.');
  }

  // ---------- recipe form ----------
  function openForm(existing){
    editingId = existing ? existing.id : null;
    $('form-title').textContent = existing ? '레시피 수정' : '레시피 추가';
    $('f-title').value = existing ? existing.title : '';
    $('f-time').value = existing ? (existing.cookTime || '') : '';
    $('f-source').value = existing ? (existing.source || '') : '';
    photoFullData = existing ? (existing.photo || null) : null;
    photoThumbData = null;
    renderPhotoPreview();

    $('ingredients-rows').innerHTML = '';
    ingredientCount = 0;
    if(existing && existing.ingredients && existing.ingredients.length){
      existing.ingredients.forEach(ing => addIngredientRow(ing.name, ing.amount));
    }else{
      addIngredientRow('', '');
    }

    $('steps-rows').innerHTML = '';
    stepCount = 0;
    if(existing && existing.steps && existing.steps.length){
      existing.steps.forEach(s => addStepRow(s));
    }else{
      addStepRow('');
    }

    $('form-overlay').classList.remove('hidden');
  }
  function closeForm(){ $('form-overlay').classList.add('hidden'); }

  function renderPhotoPreview(){
    const wrap = $('photo-preview-wrap');
    if(photoFullData){
      wrap.innerHTML = `<img src="${photoFullData}">`;
    }else{
      wrap.innerHTML = `<span class="ph-label">📷 탭해서 사진 찍기 / 선택하기</span>`;
    }
  }

  function addIngredientRow(name, amount){
    ingredientCount++;
    const div = document.createElement('div');
    div.className = 'row2';
    div.innerHTML = `
      <input type="text" class="ing-name" placeholder="재료명 (예: 두부)" value="${escapeAttr(name)}">
      <input type="text" class="ing-amt" placeholder="양 (예: 1모)" value="${escapeAttr(amount)}">
      <button class="row-x" type="button">✕</button>
    `;
    div.querySelector('.row-x').addEventListener('click', ()=> div.remove());
    $('ingredients-rows').appendChild(div);
  }

  function addStepRow(text){
    stepCount++;
    const div = document.createElement('div');
    div.className = 'row-step';
    div.innerHTML = `
      <textarea class="step-text-input" rows="2" placeholder="단계 설명을 적어주세요">${escapeHtml(text)}</textarea>
      <button class="row-x" type="button">✕</button>
    `;
    div.querySelector('.row-x').addEventListener('click', ()=> div.remove());
    $('steps-rows').appendChild(div);
  }

  async function handlePhotoInput(e){
    const file = e.target.files[0];
    if(!file) return;
    try{
      showToast('사진을 처리하고 있어요...');
      photoFullData = await compressImage(file, 900, 0.72);
      photoThumbData = await compressImage(file, 260, 0.6);
      renderPhotoPreview();
    }catch(err){
      showToast('사진을 불러오지 못했어요.');
    }
  }

  async function saveRecipe(){
    const title = $('f-title').value.trim();
    if(!title){ showToast('요리 이름을 입력해주세요.'); return; }
    const cookTime = parseInt($('f-time').value, 10) || null;
    const source = $('f-source').value.trim();

    const ingredients = [...document.querySelectorAll('#ingredients-rows .row2')].map(row=>({
      name: row.querySelector('.ing-name').value.trim(),
      amount: row.querySelector('.ing-amt').value.trim()
    })).filter(i => i.name);

    const steps = [...document.querySelectorAll('#steps-rows .row-step')].map(row=>
      row.querySelector('.step-text-input').value.trim()
    ).filter(s => s);

    const id = editingId || ('r_' + Date.now() + '_' + Math.random().toString(36).slice(2,7));
    const createdAt = editingId
      ? (recipeIndex.find(r=>r.id===id) || {}).createdAt || Date.now()
      : Date.now();

    let finalPhoto = photoFullData;
    let finalThumb = photoThumbData;
    if(editingId && !photoThumbData){
      const existingEntry = recipeIndex.find(r => r.id === id);
      finalThumb = existingEntry ? existingEntry.thumb : null;
    }

    const fullRecipe = { id, title, cookTime, source, photo: finalPhoto, ingredients, steps, createdAt };

    const saveOk = await storageSet('recipe:' + id, JSON.stringify(fullRecipe));
    if(!saveOk){ showToast('저장에 실패했어요. 다시 시도해주세요.'); return; }

    const indexEntry = { id, title, cookTime, thumb: finalThumb, source, createdAt };
    const existingIdx = recipeIndex.findIndex(r => r.id === id);
    if(existingIdx >= 0) recipeIndex[existingIdx] = indexEntry;
    else recipeIndex.push(indexEntry);
    await storageSet('recipe-index', JSON.stringify(recipeIndex));

    closeForm();
    renderGrid();
    showToast(editingId ? '수정했어요!' : '레시피를 추가했어요!');
  }

  // ---------- change password ----------
  async function changePasscode(){
    const cur = prompt('현재 관리자 비밀번호를 입력해주세요.');
    if(cur === null) return;
    const stored = await storageGet('site-passcode');
    if(!stored.ok || cur !== stored.value){ showToast('현재 비밀번호가 일치하지 않아요.'); return; }
    const next = prompt('새 비밀번호를 입력해주세요.');
    if(!next) return;
    await storageSet('site-passcode', next);
    showToast('비밀번호를 변경했어요.');
  }

  // ---------- wire up ----------
  document.addEventListener('DOMContentLoaded', ()=>{
    initGate();

    $('setup-btn').addEventListener('click', handleSetup);
    $('setup-pw-confirm').addEventListener('keydown', e=>{ if(e.key==='Enter') handleSetup(); });
    $('admin-login-btn').addEventListener('click', handleAdminLogin);
    $('admin-pw-input').addEventListener('keydown', e=>{ if(e.key==='Enter') handleAdminLogin(); });

    $('fab-add').addEventListener('click', ()=> openForm(null));
    $('form-close').addEventListener('click', closeForm);
    $('form-cancel').addEventListener('click', closeForm);
    $('form-save').addEventListener('click', saveRecipe);
    $('detail-close').addEventListener('click', closeDetail);
    $('detail-overlay').addEventListener('click', (e)=>{ if(e.target.id==='detail-overlay') closeDetail(); });
    $('form-overlay').addEventListener('click', (e)=>{ if(e.target.id==='form-overlay') closeForm(); });

    $('photo-input').addEventListener('change', handlePhotoInput);
    $('add-ingredient').addEventListener('click', ()=> addIngredientRow('', ''));
    $('add-step').addEventListener('click', ()=> addStepRow(''));
    $('search-input').addEventListener('input', renderGrid);
    $('settings-btn').addEventListener('click', changePasscode);
  });
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Structural verification — removed features are absent**

Run:
```bash
cd "/Users/yumigo/Documents/AI_Claude/0712/vercel-recipe-box"
grep -c "join-requests\|invite-codes\|panel-request\|panel-waiting\|panel-denied\|panel-invite\|req-badge\|admin-panel-btn\|admin-overlay" admin.html
```
Expected: `0`

- [ ] **Step 3: Structural verification — required features are present**

Run:
```bash
grep -c "fab-add\|form-overlay\|edit-btn\|delete-btn\|site-passcode\|conn-banner" admin.html
```
Expected: a count greater than `0` for each pattern.

- [ ] **Step 4: Commit**

```bash
git add admin.html
git commit -m "feat: add password-gated admin.html for recipe CRUD"
```

---

### Task 5: `vercel.json` — `/admin` routing

**Files:**
- Create: `vercel.json`

**Interfaces:**
- Consumes: `admin.html` (Task 4) as the rewrite destination.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Create vercel.json**

```json
{
  "rewrites": [
    { "source": "/admin", "destination": "/admin.html" }
  ]
}
```

- [ ] **Step 2: Validate JSON syntax**

Run:
```bash
cd "/Users/yumigo/Documents/AI_Claude/0712/vercel-recipe-box"
python3 -c "import json; json.load(open('vercel.json')); print('valid json')"
```
Expected output: `valid json`

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat: add /admin rewrite to admin.html"
```

---

### Task 6: Update `배포방법.md`

**Files:**
- Modify: `배포방법.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Replace 배포방법.md contents**

Replace the entire file with:

```markdown
# Yumi G's Recipe — Vercel 배포 방법

코딩을 몰라도 아래 순서를 그대로 따라 하시면 됩니다. 터미널(명령어 창)에 복사-붙여넣기만 하면 돼요.

## 이번 버전에서 달라진 점
- 레시피를 보는 페이지(`https://yumigos-recipe.vercel.app`)는 이제 누구나 링크만 있으면 바로 볼 수 있어요. 로그인이나 승인 절차가 없어요.
- 레시피를 추가/수정/삭제하려면 관리자 페이지(`https://yumigos-recipe.vercel.app/admin`)로 들어가서 비밀번호를 입력해야 해요.

## 준비물
- Node.js 설치 (https://nodejs.org 에서 "LTS" 버전 다운로드 후 설치)
- Vercel 계정 (https://vercel.com 에서 무료 가입, GitHub/Google 계정으로 가능) — 기존에 만든 `yumigos-recipe` 프로젝트와 같은 계정이어야 해요.

## 1. 터미널 열기
- 맥: Spotlight(⌘+Space)에서 "터미널" 검색
- 이 폴더(vercel-recipe-box)로 이동:
  ```
  cd 다운로드받은_폴더_경로/vercel-recipe-box
  ```

## 2. Vercel CLI 설치 (최초 1회만)
```
npm install -g vercel
```

## 3. Vercel 로그인
```
vercel login
```
브라우저가 열리면 로그인 진행

## 4. 기존 프로젝트에 다시 연결하기 (중요!)
이 폴더는 예전에 만든 `yumigos-recipe` 프로젝트를 다시 사용하는 거예요. **반드시 기존 프로젝트에 연결**해야 데이터베이스(레시피 데이터)가 그대로 보입니다.
```
vercel
```
질문이 나오면 이렇게 답하세요:
- Set up and deploy? → y
- Which scope? → 본인 계정 선택
- **Link to existing project? → y** (예전과 다르게 이번엔 꼭 y로 답하세요!)
- What's the name of your existing project? → **yumigos-recipe** (기존 이름 정확히 입력)

이 단계는 프로젝트를 연결만 하는 것이니, 실제 배포는 다음 단계에서 합니다.

## 5. 배포하기
```
vercel --prod
```
완료되면 `https://yumigos-recipe.vercel.app` 에 새 버전이 반영돼요.

## 6. 관리자 비밀번호 설정
브라우저에서 `https://yumigos-recipe.vercel.app/admin` 접속 → 처음이면 관리자 비밀번호 설정 화면이 나와요.

## 7. 완료!
- 레시피 보기: `https://yumigos-recipe.vercel.app` (링크만 있으면 누구나)
- 레시피 추가/수정/삭제: `https://yumigos-recipe.vercel.app/admin` (비밀번호 필요)

---

## 나중에 사이트 내용을 수정하고 싶을 때
Claude에게 수정된 파일을 다시 받은 뒤, 같은 폴더에서:
```
vercel --prod
```
**주의: `vercel --prod` 없이 그냥 `vercel`만 실행하면 안 됩니다.** `vercel`만 실행하면 매번 다른 미리보기 주소가 생기고, 그 주소는 진짜 데이터베이스에 연결이 안 될 수 있어요 (레시피가 사라진 것처럼 보이는 원인이 바로 이거였어요). 항상 `--prod`를 붙여서 같은 주소로 배포하세요.

## 문제가 생기면
- 레시피 목록 화면 위에 빨간 "저장소 연결에 실패했어요" 배너가 뜨면 → 데이터베이스 연결 문제입니다. Vercel 대시보드 → 프로젝트 → Storage 탭에서 KV(Redis)가 연결되어 있는지 확인하세요.
- "저장 실패" 오류가 나면 → 위와 같은 원인일 가능성이 높습니다.
- 막히는 부분 있으면 화면 캡처해서 Claude에게 보여주세요.
```

- [ ] **Step 2: Commit**

```bash
git add 배포방법.md
git commit -m "docs: update deployment guide for two-page structure and existing-project relink"
```

---

### Task 7: Manual deployment & end-to-end verification

**Files:** none (operational steps, not code)

**Interfaces:** none — this task exercises the whole system built in Tasks 1–6.

This task requires the user's own Vercel account and terminal access, so it is performed by the user (or with the user directly present), not run unattended by an agent.

- [ ] **Step 1: Local structural sanity check (no server needed)**

Open `index.html` directly in a browser (double-click the file, or `open index.html` on macOS). Since there is no `/api/kv` available without a real server, the page should show the **"저장소 연결에 실패했어요"** banner rather than "아직 레시피가 없어요" — this confirms the ok/value distinction from Task 2 is wired correctly end-to-end. Do the same for `admin.html`; it should also show the connection banner instead of silently proceeding to the setup screen.

- [ ] **Step 2: Reconnect to the existing Vercel project**

Confirm with the user before running any Vercel commands — this touches a real, shared deployment:

```bash
cd "/Users/yumigo/Documents/AI_Claude/0712/vercel-recipe-box"
vercel
```
Answer the prompts exactly as documented in the updated `배포방법.md` Step 4 (critically: **"Link to existing project?" → y**, project name `yumigos-recipe`).

- [ ] **Step 3: Deploy to production**

```bash
vercel --prod
```
Expected: deployment succeeds and prints `https://yumigos-recipe.vercel.app`.

- [ ] **Step 4: Verify the public page**

Visit `https://yumigos-recipe.vercel.app`. Expected: recipes (if any existed in the KV store already) show immediately with no login, OR a clean "아직 레시피가 없어요" empty state if the store is genuinely empty — either way, no connection-failure banner (confirming Task 2's fix works against the real database). View page source and confirm there is no link, button, or reference to `/admin` anywhere.

- [ ] **Step 5: Verify the admin page**

Visit `https://yumigos-recipe.vercel.app/admin`. Expected: setup screen (if no admin password ever set) or login screen. Log in, add a test recipe, confirm it appears in the admin grid. Reload `https://yumigos-recipe.vercel.app` (the public page, in a new tab/incognito) and confirm the new recipe appears there too — this is the actual regression test for the original "recipes disappear" bug.

- [ ] **Step 6: Verify edit and delete**

From the admin page, edit the test recipe (change the title) and confirm the change appears on the public page after reload. Delete the test recipe from the admin page and confirm it disappears from the public page after reload.
