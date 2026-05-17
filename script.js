// --- IndexedDB の設定 ---
const DB_NAME = 'PonDashiAppDB';
const STORE_NAME_AUDIO = 'AudioFiles';
const STORE_NAME_SECTION = 'Sections';
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 2);
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME_AUDIO)) {
                db.createObjectStore(STORE_NAME_AUDIO, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORE_NAME_SECTION)) {
                db.createObjectStore(STORE_NAME_SECTION, { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve();
        };
        request.onerror = (e) => reject(e);
    });
}

function saveData(id, file, fileName, volume, loop, mcVolume = 0.1) {
    if (!db) return;
    const transaction = db.transaction([STORE_NAME_AUDIO], 'readwrite');
    const store = transaction.objectStore(STORE_NAME_AUDIO);
    store.put({ id, file, fileName, volume, loop, mcVolume });
}

function getAllData() {
    return new Promise((resolve) => {
        if (!db) return resolve([]);
        const transaction = db.transaction([STORE_NAME_AUDIO], 'readonly');
        const store = transaction.objectStore(STORE_NAME_AUDIO);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
    });
}

function clearDataByType(typePrefix) {
    return new Promise((resolve) => {
        if (!db) return resolve();
        const transaction = db.transaction([STORE_NAME_AUDIO], 'readwrite');
        const store = transaction.objectStore(STORE_NAME_AUDIO);
        const request = store.openCursor();
        request.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                if (cursor.key.startsWith(typePrefix + '-')) {
                    cursor.delete();
                }
                cursor.continue();
            } else {
                resolve();
            }
        };
    });
}

function saveSection(id, title, style, order, isCollapsed = false) {
    if (!db) return;
    const tx = db.transaction([STORE_NAME_SECTION], 'readwrite');
    tx.objectStore(STORE_NAME_SECTION).put({ id, title, style, order, isCollapsed });
}

function getAllSections() {
    return new Promise((resolve) => {
        if (!db) return resolve([]);
        const tx = db.transaction([STORE_NAME_SECTION], 'readonly');
        const req = tx.objectStore(STORE_NAME_SECTION).getAll();
        req.onsuccess = () => {
            let res = req.result;
            res.sort((a, b) => a.order - b.order);
            resolve(res);
        };
    });
}

function deleteSectionFromDB(id) {
    if (!db) return;
    const tx = db.transaction([STORE_NAME_SECTION], 'readwrite');
    tx.objectStore(STORE_NAME_SECTION).delete(id);
}

// --- メイン処理 ---
let sections = [];
let sectionCounts = {};
let autoPlayStates = {};
let overlapPlayStates = {}; // 重ねて再生の設定
let navVisibilityStates = {}; // 目次に表示の設定

// --- メモ＆テンプレート機能 ---
let templates = [];
const MEMO_STORAGE_KEY = 'pondashi_current_memo';
const TEMPLATE_STORAGE_KEY = 'pondashi_templates';

// --- カスタムプロンプト（Electron・デスクトップ版対応用） ---
function customPrompt(message, defaultValue = '') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        overlay.style.zIndex = '9999';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';

        const modal = document.createElement('div');
        modal.style.backgroundColor = '#2a2a2a';
        modal.style.padding = '20px';
        modal.style.borderRadius = '8px';
        modal.style.boxShadow = '0 4px 10px rgba(0,0,0,0.5)';
        modal.style.width = '400px';
        modal.style.maxWidth = '90%';
        modal.style.color = '#fff';
        modal.style.fontFamily = 'inherit';

        const msgEl = document.createElement('div');
        msgEl.innerText = message;
        msgEl.style.marginBottom = '15px';
        msgEl.style.lineHeight = '1.4';
        modal.appendChild(msgEl);

        const inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.value = defaultValue;
        inputEl.style.width = '100%';
        inputEl.style.padding = '8px';
        inputEl.style.boxSizing = 'border-box';
        inputEl.style.marginBottom = '20px';
        inputEl.style.backgroundColor = '#111';
        inputEl.style.color = '#fff';
        inputEl.style.border = '1px solid #555';
        inputEl.style.borderRadius = '4px';
        inputEl.style.fontSize = '1em';
        modal.appendChild(inputEl);

        const btnArea = document.createElement('div');
        btnArea.style.display = 'flex';
        btnArea.style.justifyContent = 'flex-end';
        btnArea.style.gap = '10px';

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = 'キャンセル';
        cancelBtn.style.padding = '8px 16px';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.style.backgroundColor = '#555';
        cancelBtn.style.color = '#fff';
        cancelBtn.style.border = 'none';
        cancelBtn.style.borderRadius = '4px';
        
        const okBtn = document.createElement('button');
        okBtn.innerText = 'OK';
        okBtn.style.padding = '8px 16px';
        okBtn.style.cursor = 'pointer';
        okBtn.style.backgroundColor = '#4CAF50';
        okBtn.style.color = '#fff';
        okBtn.style.border = 'none';
        okBtn.style.borderRadius = '4px';

        btnArea.appendChild(cancelBtn);
        btnArea.appendChild(okBtn);
        modal.appendChild(btnArea);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        inputEl.focus();
        inputEl.select();

        const close = (val) => {
            if(document.body.contains(overlay)) {
                document.body.removeChild(overlay);
            }
            resolve(val);
        };

        cancelBtn.addEventListener('click', () => close(null));
        okBtn.addEventListener('click', () => close(inputEl.value));
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') close(inputEl.value);
            if (e.key === 'Escape') close(null);
        });
    });
}

function customAlert(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed'; overlay.style.top = '0'; overlay.style.left = '0'; overlay.style.width = '100vw'; overlay.style.height = '100vh'; overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)'; overlay.style.zIndex = '9999'; overlay.style.display = 'flex'; overlay.style.justifyContent = 'center'; overlay.style.alignItems = 'center';
        const modal = document.createElement('div');
        modal.style.backgroundColor = '#2a2a2a'; modal.style.padding = '20px'; modal.style.borderRadius = '8px'; modal.style.boxShadow = '0 4px 10px rgba(0,0,0,0.5)'; modal.style.width = '400px'; modal.style.maxWidth = '90%'; modal.style.color = '#fff'; modal.style.fontFamily = 'inherit';
        const msgEl = document.createElement('div');
        msgEl.innerText = message; msgEl.style.marginBottom = '20px'; msgEl.style.lineHeight = '1.4';
        modal.appendChild(msgEl);
        const btnArea = document.createElement('div');
        btnArea.style.display = 'flex'; btnArea.style.justifyContent = 'flex-end';
        const okBtn = document.createElement('button');
        okBtn.innerText = 'OK'; okBtn.style.padding = '8px 16px'; okBtn.style.cursor = 'pointer'; okBtn.style.backgroundColor = '#4CAF50'; okBtn.style.color = '#fff'; okBtn.style.border = 'none'; okBtn.style.borderRadius = '4px';
        btnArea.appendChild(okBtn); modal.appendChild(btnArea); overlay.appendChild(modal); document.body.appendChild(overlay);
        okBtn.focus();
        const close = () => { if(document.body.contains(overlay)) document.body.removeChild(overlay); resolve(); };
        okBtn.addEventListener('click', close);
    });
}

function customConfirm(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed'; overlay.style.top = '0'; overlay.style.left = '0'; overlay.style.width = '100vw'; overlay.style.height = '100vh'; overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)'; overlay.style.zIndex = '9999'; overlay.style.display = 'flex'; overlay.style.justifyContent = 'center'; overlay.style.alignItems = 'center';
        const modal = document.createElement('div');
        modal.style.backgroundColor = '#2a2a2a'; modal.style.padding = '20px'; modal.style.borderRadius = '8px'; modal.style.boxShadow = '0 4px 10px rgba(0,0,0,0.5)'; modal.style.width = '400px'; modal.style.maxWidth = '90%'; modal.style.color = '#fff'; modal.style.fontFamily = 'inherit';
        const msgEl = document.createElement('div');
        msgEl.innerText = message; msgEl.style.marginBottom = '20px'; msgEl.style.lineHeight = '1.4';
        modal.appendChild(msgEl);
        const btnArea = document.createElement('div');
        btnArea.style.display = 'flex'; btnArea.style.justifyContent = 'flex-end'; btnArea.style.gap = '10px';
        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = 'キャンセル'; cancelBtn.style.padding = '8px 16px'; cancelBtn.style.cursor = 'pointer'; cancelBtn.style.backgroundColor = '#555'; cancelBtn.style.color = '#fff'; cancelBtn.style.border = 'none'; cancelBtn.style.borderRadius = '4px';
        const okBtn = document.createElement('button');
        okBtn.innerText = 'OK'; okBtn.style.padding = '8px 16px'; okBtn.style.cursor = 'pointer'; okBtn.style.backgroundColor = '#4CAF50'; okBtn.style.color = '#fff'; okBtn.style.border = 'none'; okBtn.style.borderRadius = '4px';
        btnArea.appendChild(cancelBtn); btnArea.appendChild(okBtn); modal.appendChild(btnArea); overlay.appendChild(modal); document.body.appendChild(overlay);
        const close = (val) => { if(document.body.contains(overlay)) document.body.removeChild(overlay); resolve(val); };
        cancelBtn.addEventListener('click', () => close(false));
        okBtn.addEventListener('click', () => close(true));
    });
}

function showCopyMoveModal(optionsHtml) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed'; overlay.style.top = '0'; overlay.style.left = '0'; overlay.style.width = '100vw'; overlay.style.height = '100vh'; overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)'; overlay.style.zIndex = '9999'; overlay.style.display = 'flex'; overlay.style.justifyContent = 'center'; overlay.style.alignItems = 'center';
        overlay.innerHTML = `
            <div style="background-color:#2a2a2a; padding:20px; border-radius:8px; width:400px; max-width:90%; color:#fff; font-family:inherit;">
                <h3 style="margin-top:0;">枠のコピー / 移動</h3>
                <p style="font-size:0.9em; margin-bottom:15px;">この枠をどの欄にコピーまたは移動しますか？</p>
                <select id="cm-sec-select" style="width:100%; padding:8px; margin-bottom:20px; font-size:1em; background:#111; color:#fff; border:1px solid #555; border-radius:4px;">
                    ${optionsHtml}
                </select>
                <div style="display:flex; justify-content:flex-end; gap:10px;">
                    <button id="cm-cancel" style="padding:8px 16px; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">キャンセル</button>
                    <button id="cm-copy" style="padding:8px 16px; background:#2196F3; color:#fff; border:none; border-radius:4px; cursor:pointer;">📋 コピー(複製)</button>
                    <button id="cm-move" style="padding:8px 16px; background:#4CAF50; color:#fff; border:none; border-radius:4px; cursor:pointer;">➡️ 移動</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const close = (val) => { if(document.body.contains(overlay)) document.body.removeChild(overlay); resolve(val); };

        overlay.querySelector('#cm-cancel').addEventListener('click', () => close(null));
        overlay.querySelector('#cm-copy').addEventListener('click', () => {
            const val = overlay.querySelector('#cm-sec-select').value;
            close({ secId: val, action: 'copy' });
        });
        overlay.querySelector('#cm-move').addEventListener('click', () => {
            const val = overlay.querySelector('#cm-sec-select').value;
            close({ secId: val, action: 'move' });
        });
    });
}

function initMemo() {
    const memoArea = document.getElementById('memo-area');
    const templateSelect = document.getElementById('template-select');
    const loadBtn = document.getElementById('load-template-btn');
    const saveBtn = document.getElementById('save-template-btn');
    const updateBtn = document.getElementById('update-template-btn');
    const deleteBtn = document.getElementById('delete-template-btn');

    // テンプレート欄の折りたたみ
    const templateToggle = document.getElementById('template-toggle');
    const templateBody = document.getElementById('template-body');
    const templateToggleIcon = document.getElementById('template-toggle-icon');
    const TEMPLATE_COLLAPSED_KEY = 'pondashi_template_collapsed';

    if (localStorage.getItem(TEMPLATE_COLLAPSED_KEY) === '1') {
        templateBody.style.display = 'none';
        templateToggleIcon.textContent = '▶';
    }
    templateToggle.addEventListener('click', () => {
        const isCollapsed = templateBody.style.display === 'none';
        templateBody.style.display = isCollapsed ? 'block' : 'none';
        templateToggleIcon.textContent = isCollapsed ? '▼' : '▶';
        localStorage.setItem(TEMPLATE_COLLAPSED_KEY, isCollapsed ? '0' : '1');
    });

    // 保存されているメモの復元
    const savedMemo = localStorage.getItem(MEMO_STORAGE_KEY);
    if (savedMemo) {
        memoArea.value = savedMemo;
    }

    // メモ入力時に自動保存
    memoArea.addEventListener('input', () => {
        localStorage.setItem(MEMO_STORAGE_KEY, memoArea.value);
    });

    // テンプレートの読み込み
    const savedTemplates = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (savedTemplates) {
        try {
            templates = JSON.parse(savedTemplates);
        } catch(e) {
            templates = [];
        }
    }

    function renderTemplateOptions() {
        templateSelect.innerHTML = '<option value="">-- テンプレートを選択 --</option>';
        templates.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name;
            templateSelect.appendChild(opt);
        });
    }
    renderTemplateOptions();

    // 読み込み
    loadBtn.addEventListener('click', async () => {
        const id = templateSelect.value;
        if (!id) { await customAlert('読み込むテンプレートを選択してください。'); return; }
        const t = templates.find(x => x.id === id);
        if (t) {
            if (memoArea.value.trim() !== '') {
                const ok = await customConfirm('現在のメモが上書きされます。よろしいですか？');
                if (!ok) return;
            }
            memoArea.value = t.content;
            localStorage.setItem(MEMO_STORAGE_KEY, memoArea.value);
        }
    });

    // 新規保存
    saveBtn.addEventListener('click', async () => {
        if (memoArea.value.trim() === '') { await customAlert('メモが空です。保存する内容を入力してください。'); return; }
        const name = await customPrompt('新しいテンプレートの名前を入力してください\n（例: 雑談枠用、ゲーム配信枠用 など）');
        if (!name || name.trim() === '') return;
        
        const newTemplate = {
            id: 'tpl_' + Date.now(),
            name: name.trim(),
            content: memoArea.value
        };
        templates.push(newTemplate);
        localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
        renderTemplateOptions();
        templateSelect.value = newTemplate.id;
        await customAlert(`テンプレート「${newTemplate.name}」を保存しました！`);
    });

    // 上書き保存
    updateBtn.addEventListener('click', async () => {
        const id = templateSelect.value;
        if (!id) { await customAlert('上書きするテンプレートをプルダウンから選択してください。'); return; }
        if (memoArea.value.trim() === '') { await customAlert('メモが空です。'); return; }
        
        const t = templates.find(x => x.id === id);
        if (t) {
            const ok = await customConfirm(`「${t.name}」を現在のメモ内容で上書きしますか？`);
            if (ok) {
                t.content = memoArea.value;
                localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
                await customAlert('上書き保存しました！');
            }
        }
    });

    // 削除
    deleteBtn.addEventListener('click', async () => {
        const id = templateSelect.value;
        if (!id) { await customAlert('削除するテンプレートを選択してください。'); return; }
        
        const t = templates.find(x => x.id === id);
        if (t) {
            const ok = await customConfirm(`本当にテンプレート「${t.name}」を削除しますか？`);
            if (ok) {
                templates = templates.filter(x => x.id !== id);
                localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
                renderTemplateOptions();
                await customAlert('テンプレートを削除しました。');
            }
        }
    });
}

const DEFAULT_SECTIONS = [
  { id: "bgm", title: "🎵 曲・BGM", style: "bgm", order: 1, isCollapsed: false },
  { id: "jingle1", title: "📢 ジングル・CM", style: "bgm", order: 2, isCollapsed: false },
  { id: "se", title: "💥 効果音", style: "pad", order: 3, isCollapsed: false },
  { id: "other", title: "🎵 その他", style: "bgm", order: 4, isCollapsed: false }
];

document.addEventListener('DOMContentLoaded', async () => {
    initMemo(); // メモ機能の初期化
    try {
        await initDB();
        sections = await getAllSections();
        if (sections.length === 0) {
            sections = DEFAULT_SECTIONS;
            sections.forEach(s => saveSection(s.id, s.title, s.style, s.order, s.isCollapsed));
        }

        // 既存アイテムの音量を75%に一括更新（初回のみ）
        const VOLUME_MIGRATION_KEY = 'pondashi_volume_migration_v1';
        if (!localStorage.getItem(VOLUME_MIGRATION_KEY)) {
            const allData = await getAllData();
            allData.forEach(data => {
                saveData(data.id, data.file, data.fileName, 0.75, data.loop, data.mcVolume);
            });
            localStorage.setItem(VOLUME_MIGRATION_KEY, '1');
        }

        const savedAudioData = await getAllData();

        sections.forEach(sec => {
            sectionCounts[sec.id] = 0;
            autoPlayStates[sec.id] = false;
        });

        // 重ねて再生の初期値読み込み
        try {
            const savedOverlap = localStorage.getItem('pondashi_overlap_states');
            if (savedOverlap) {
                overlapPlayStates = JSON.parse(savedOverlap);
            }
        } catch(e) {}
        // デフォルトでは 効果音(se) などは重ねて再生をtrueにする
        sections.forEach(sec => {
            if (overlapPlayStates[sec.id] === undefined) {
                overlapPlayStates[sec.id] = (sec.style === 'pad'); // pad(効果音)はデフォルトtrue
            }
        });

        // 目次表示の初期値読み込み
        try {
            const savedNavVisibility = localStorage.getItem('pondashi_nav_visibility');
            if (savedNavVisibility) {
                navVisibilityStates = JSON.parse(savedNavVisibility);
            }
        } catch(e) {}
        sections.forEach(sec => {
            if (navVisibilityStates[sec.id] === undefined) {
                navVisibilityStates[sec.id] = true; // デフォルトは表示
            }
        });

        savedAudioData.forEach(data => {
            const parts = data.id.split('-');
            const secId = parts[0];
            const idx = parseInt(parts[1]);
            if (sectionCounts[secId] !== undefined && idx > sectionCounts[secId]) {
                sectionCounts[secId] = idx;
            }
        });

        renderAllSections(savedAudioData);

        document.getElementById('add-section-btn').addEventListener('click', async () => {
            const title = await customPrompt("新しい欄の名前を入力してください\n（例: 「🎤 ゲスト用BGM」「📢 特殊効果音」など）");
            if (!title || title.trim() === '') return;
            
            const newId = 'custom_' + Date.now();
            const newOrder = sections.length > 0 ? Math.max(...sections.map(s => s.order)) + 1 : 1;
            const newSec = { id: newId, title: title, style: 'bgm', order: newOrder, isCollapsed: false };
            
            sections.push(newSec);
            sectionCounts[newId] = 0;
            autoPlayStates[newId] = false;
            saveSection(newId, title, 'bgm', newOrder, false);

            appendSectionDOM(newSec, []);
            updateSectionNav();
        });

        document.getElementById('add-se-section-btn').addEventListener('click', async () => {
            const title = await customPrompt("効果音の欄の名前を入力してください\n（例: 「💥 効果音①」「🔔 ベル・スイッチ」など）");
            if (!title || title.trim() === '') return;

            const newId = 'custom_' + Date.now();
            const newOrder = sections.length > 0 ? Math.max(...sections.map(s => s.order)) + 1 : 1;
            const newSec = { id: newId, title: title, style: 'pad', order: newOrder, isCollapsed: false };

            sections.push(newSec);
            sectionCounts[newId] = 0;
            autoPlayStates[newId] = false;
            overlapPlayStates[newId] = true;
            saveSection(newId, title, 'pad', newOrder, false);

            appendSectionDOM(newSec, []);
            updateSectionNav();
        });

        initDataTransfer(); // データ引き継ぎ機能の初期化
        initResetButton();  // リセットボタンの初期化
    } catch (e) {
        console.error("データベースエラー", e);
    }
});

function updateSectionNav() {
    const nav = document.getElementById('section-nav');
    if (!nav) return;
    nav.innerHTML = '';
    sections.forEach(sec => {
        if (navVisibilityStates[sec.id] === false) return;
        const btn = document.createElement('button');
        btn.textContent = sec.title;
        btn.style.cssText = 'padding: 4px 14px; background: #2a2a2a; color: #e0e0e0; border: 1px solid #444; border-radius: 20px; cursor: pointer; font-size: 0.85em; white-space: nowrap; transition: background 0.2s;';
        btn.addEventListener('mouseover', () => btn.style.background = '#3a3a3a');
        btn.addEventListener('mouseout', () => btn.style.background = '#2a2a2a');
        btn.addEventListener('click', () => {
            const target = document.getElementById(`${sec.id}-section`);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        nav.appendChild(btn);
    });
}

function renderAllSections(savedAudioData) {
    const container = document.getElementById('sections-container');
    container.innerHTML = '';
    sections.forEach(sec => {
        appendSectionDOM(sec, savedAudioData);
    });
    updateSectionNav();
}

function appendSectionDOM(sec, savedAudioData) {
    const mainContainer = document.getElementById('sections-container');
    const sectionEl = document.createElement('section');
    sectionEl.id = `${sec.id}-section`;
    sectionEl.style.marginBottom = "30px";
    
    // 確実なクリックによる移動と、折りたたみ機能、名前変更機能を実装
    sectionEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:15px; border-bottom: 2px solid var(--border-color); padding-bottom:5px;">
            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:10px;">
                <div style="display:flex; flex-direction:column; gap:2px; margin-right:10px;">
                    <button class="move-up-btn" data-sec="${sec.id}" style="cursor:pointer; padding:2px 8px; font-size:1.1em; border-radius:3px; border:none; background:#444; color:white;" title="欄を上へ移動">🔼</button>
                    <button class="move-down-btn" data-sec="${sec.id}" style="cursor:pointer; padding:2px 8px; font-size:1.1em; border-radius:3px; border:none; background:#444; color:white;" title="欄を下へ移動">🔽</button>
                </div>
                <h2 style="margin:0; border:none; padding:0; display:flex; align-items:center; gap:5px;">
                    <span class="collapse-toggle" style="cursor:pointer; display:inline-block; width:24px; text-align:center; font-size:0.9em; user-select:none; opacity:0.8;" title="欄を折りたたむ/開く">${sec.isCollapsed ? '▶' : '▼'}</span>
                    <span class="section-title-text" style="cursor:pointer; text-decoration:underline dashed; text-underline-offset:4px;" title="クリックして名前を変更">${sec.title}</span>
                    <button class="edit-title-btn" style="background:none; border:none; cursor:pointer; font-size:0.8em;" title="名前を変更">✏️</button>
                </h2>
                <button class="add-btn" style="background:#4CAF50; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; white-space:nowrap; margin-left:10px; font-size:0.9em;">+ 新しい枠を追加</button>
                <label style="font-size:0.9em; display:flex; align-items:center;">
                    <input type="checkbox" class="auto-play-check" ${autoPlayStates[sec.id] ? 'checked' : ''} style="margin-right:3px;">
                    連続再生
                </label>
            </div>
            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:10px; justify-content:flex-end;">
                <label style="font-size:0.9em; display:flex; align-items:center;" title="チェックを入れると他の音を止めずに重ねて鳴らします">
                    <input type="checkbox" class="overlap-play-check" ${overlapPlayStates[sec.id] ? 'checked' : ''} style="margin-right:3px;">
                    重ねて再生
                </label>
                <label style="font-size:0.9em; display:flex; align-items:center;" title="チェックを外すと目次に表示されなくなります">
                    <input type="checkbox" class="nav-visibility-check" ${navVisibilityStates[sec.id] !== false ? 'checked' : ''} style="margin-right:3px;">
                    目次
                </label>
                <button class="delete-sec-btn" data-sec="${sec.id}" style="background:none; border:none; color:#ff5555; cursor:pointer; font-size:0.85em; text-decoration:underline; white-space:nowrap;">🗑️ 欄ごと削除</button>
            </div>
        </div>
        <div id="${sec.id}-container" class="grid-container ${sec.style === 'pad' ? 'pad-grid' : 'bgm-grid'}" style="display: ${sec.isCollapsed ? 'none' : 'grid'};">
        </div>
    `;
    mainContainer.appendChild(sectionEl);

    const itemsContainer = document.getElementById(`${sec.id}-container`);
    const toggleBtn = sectionEl.querySelector('.collapse-toggle');

    // タイトル編集イベント
    const editTitleHandler = async () => {
        const newTitle = await customPrompt("欄の新しい名前を入力してください", sec.title);
        if (newTitle !== null && newTitle.trim() !== "") {
            sec.title = newTitle.trim();
            sectionEl.querySelector('.section-title-text').textContent = sec.title;
            saveSection(sec.id, sec.title, sec.style, sec.order, sec.isCollapsed);
            updateItemTitles(sec.id);
            updateSectionNav();
        }
    };
    sectionEl.querySelector('.section-title-text').addEventListener('click', editTitleHandler);
    sectionEl.querySelector('.edit-title-btn').addEventListener('click', editTitleHandler);

    // 折りたたみイベント
    toggleBtn.addEventListener('click', () => {
        sec.isCollapsed = !sec.isCollapsed;
        toggleBtn.textContent = sec.isCollapsed ? '▶' : '▼';
        itemsContainer.style.display = sec.isCollapsed ? 'none' : 'grid';
        saveSection(sec.id, sec.title, sec.style, sec.order, sec.isCollapsed);
    });

    // 枠追加イベント
    sectionEl.querySelector('.add-btn').addEventListener('click', () => {
        if (sec.isCollapsed) {
            sec.isCollapsed = false;
            toggleBtn.textContent = '▼';
            itemsContainer.style.display = 'grid';
            saveSection(sec.id, sec.title, sec.style, sec.order, sec.isCollapsed);
        }
        sectionCounts[sec.id]++;
        createItem(sectionCounts[sec.id], sec.id, sec.style, itemsContainer);
    });

    sectionEl.querySelector('.auto-play-check').addEventListener('change', (e) => {
        autoPlayStates[sec.id] = e.target.checked;
    });

    sectionEl.querySelector('.overlap-play-check').addEventListener('change', (e) => {
        overlapPlayStates[sec.id] = e.target.checked;
        localStorage.setItem('pondashi_overlap_states', JSON.stringify(overlapPlayStates));
    });

    sectionEl.querySelector('.nav-visibility-check').addEventListener('change', (e) => {
        navVisibilityStates[sec.id] = e.target.checked;
        localStorage.setItem('pondashi_nav_visibility', JSON.stringify(navVisibilityStates));
        updateSectionNav();
    });

    sectionEl.querySelector('.delete-sec-btn').addEventListener('click', async () => {
        const ok = await customConfirm(`本当に「${sec.title}」の欄を削除しますか？\nセットされている音声データもすべて消去されます。`);
        if (ok) {
            await clearDataByType(sec.id);
            deleteSectionFromDB(sec.id);
            sections = sections.filter(s => s.id !== sec.id);
            delete sectionCounts[sec.id];
            delete autoPlayStates[sec.id];
            sectionEl.remove();
            updateSectionNav();
        }
    });

    // 上移動イベント
    sectionEl.querySelector('.move-up-btn').addEventListener('click', () => {
        const index = sections.findIndex(s => s.id === sec.id);
        if (index > 0) {
            const temp = sections[index - 1];
            sections[index - 1] = sections[index];
            sections[index] = temp;
            
            const tempOrder = sections[index].order;
            sections[index].order = sections[index - 1].order;
            sections[index - 1].order = tempOrder;

            saveSection(sections[index].id, sections[index].title, sections[index].style, sections[index].order, sections[index].isCollapsed);
            saveSection(sections[index - 1].id, sections[index - 1].title, sections[index - 1].style, sections[index - 1].order, sections[index - 1].isCollapsed);

            mainContainer.insertBefore(sectionEl, sectionEl.previousElementSibling);
            updateSectionNav();
        }
    });

    // 下移動イベント
    sectionEl.querySelector('.move-down-btn').addEventListener('click', () => {
        const index = sections.findIndex(s => s.id === sec.id);
        if (index < sections.length - 1) {
            const temp = sections[index + 1];
            sections[index + 1] = sections[index];
            sections[index] = temp;

            const tempOrder = sections[index].order;
            sections[index].order = sections[index + 1].order;
            sections[index + 1].order = tempOrder;

            saveSection(sections[index].id, sections[index].title, sections[index].style, sections[index].order, sections[index].isCollapsed);
            saveSection(sections[index + 1].id, sections[index + 1].title, sections[index + 1].style, sections[index + 1].order, sections[index + 1].isCollapsed);

            mainContainer.insertBefore(sectionEl.nextElementSibling, sectionEl);
            updateSectionNav();
        }
    });

    let count = sectionCounts[sec.id];
    for (let i = 1; i <= count; i++) {
        const initData = savedAudioData.find(d => d.id === `${sec.id}-${i}`);
        createItem(i, sec.id, sec.style, itemsContainer, initData);
    }
}

// 枠（アイテム）のタイトルをセクション名に合わせて一括更新する関数
function updateItemTitles(secId) {
    const items = document.querySelectorAll(`.${secId}-item`);
    items.forEach(item => {
        const idx = item.dataset.index;
        const titleEl = item.querySelector('.item-title');
        if (titleEl) {
            titleEl.textContent = `${idx}`;
        }
    });
}

async function reindexItems(secId) {
    await clearDataByType(secId);
    const items = document.querySelectorAll(`.${secId}-item`);
    sectionCounts[secId] = items.length;
    items.forEach((item, i) => {
        if (item.saveCurrentState) {
            item.saveCurrentState(i + 1);
        }
    });
}

// --- 枠のドラッグ＆ドロップ機能 ---
let draggedItem = null;

function enableDragAndDrop(item, container, secId) {
    item.draggable = true;
    item.style.cursor = 'grab';

    item.addEventListener('dragstart', (e) => {
        draggedItem = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        if(e.dataTransfer.setData) e.dataTransfer.setData('text/plain', ''); 
        e.stopPropagation(); 
    });

    item.addEventListener('dragend', (e) => {
        item.classList.remove('dragging');
        draggedItem = null;
        e.stopPropagation();
    });

    item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        item.classList.add('drag-over');
        e.stopPropagation();
    });

    item.addEventListener('dragleave', (e) => {
        item.classList.remove('drag-over');
        e.stopPropagation();
    });

    item.addEventListener('drop', async (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        e.stopPropagation();

        if (draggedItem && draggedItem !== item) {
            if (draggedItem.parentNode === container) {
                const allItems = [...container.children];
                const draggedIndex = allItems.indexOf(draggedItem);
                const targetIndex = allItems.indexOf(item);
                
                if (draggedIndex < targetIndex) {
                    container.insertBefore(draggedItem, item.nextSibling);
                } else {
                    container.insertBefore(draggedItem, item);
                }

                await reindexItems(secId);
            }
        }
    });
}

// --- 統合アイテム生成 ---
function createItem(index, secId, style, container, initialData = null) {
    const item = document.createElement('div');
    item.className = `sound-item ${style === 'pad' ? 'pad-item' : ''} ${secId}-item`;
    item.dataset.index = index; 
    
    const audio = new Audio();
    let fadeInterval;
    let isMCMode = false;
    let baseVolume = initialData?.volume !== undefined ? initialData.volume : 0.75;
    let mcVolume = initialData?.mcVolume !== undefined ? initialData.mcVolume : 0.1;
    let currentFile = initialData?.file || null;
    let currentFileName = initialData?.fileName || 'ファイル未選択';
    audio.loop = initialData?.loop || false;

    if (currentFile) {
        audio.src = URL.createObjectURL(currentFile);
    }

    let titleText = `${index}`;

    let mcHtml = '';
    let mcBtnHtml = '';
    if (style !== 'pad') {
        mcHtml = `
            <span style="margin-left:10px; font-size:0.9em;">MC時</span>
            <input type="range" min="0" max="1" step="0.01" value="${mcVolume}" class="mc-vol-slider" style="width:60px;">
        `;
        mcBtnHtml = `<button class="mc-btn">🎤 MC(音量下げる)</button>`;
    }

    item.innerHTML = `
        <div class="item-header" style="display:flex; justify-content:space-between; align-items:center;">
            <span class="item-title">${titleText}</span>
            <div style="display:flex; align-items:center;">
                ${style !== 'pad' ? `<label><input type="checkbox" class="repeat-check" ${audio.loop ? 'checked' : ''}> リピート</label>` : ''}
                <button class="copy-move-btn" style="margin-left:8px; background:none; border:none; color:#2196F3; cursor:pointer; font-size:1.1em;" title="他の欄へコピー/移動">📋</button>
                <button class="delete-btn" style="margin-left:8px; background:none; border:none; color:#ff5555; cursor:pointer; font-size:1.1em;" title="この枠を削除">✖</button>
            </div>
        </div>
        <div class="file-display" style="font-size:0.85em; color:#bbb; margin-bottom:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${currentFileName}
        </div>
        <input type="file" accept="audio/*" class="file-input">
        <div class="volume-control">
            <span>音量</span>
            <input type="range" min="0" max="1" step="0.01" value="${baseVolume}" class="vol-slider">
            ${mcHtml}
        </div>
        <div class="controls">
            <button class="play-btn">▶ 再生</button>
            <button class="stop-btn">■ 停止</button>
        </div>
        ${style !== 'pad' ? `
        <div class="controls">
            <button class="fade-in-btn">↗ フェードイン</button>
            <button class="fade-out-btn">↘ フェードアウト</button>
            ${mcBtnHtml}
        </div>` : ''}
    `;

    const fileInput = item.querySelector('.file-input');
    const fileDisplay = item.querySelector('.file-display');
    const playBtn = item.querySelector('.play-btn');
    const stopBtn = item.querySelector('.stop-btn');
    const fadeInBtn = item.querySelector('.fade-in-btn');
    const fadeOutBtn = item.querySelector('.fade-out-btn');
    const mcBtn = item.querySelector('.mc-btn');
    const volSlider = item.querySelector('.vol-slider');
    const mcVolSlider = item.querySelector('.mc-vol-slider');
    const repeatCheck = item.querySelector('.repeat-check');
    const deleteBtn = item.querySelector('.delete-btn');

    const updateDB = () => {
        saveData(`${secId}-${index}`, currentFile, currentFileName, baseVolume, audio.loop, mcVolume);
    };

    item.saveCurrentState = (newIndex) => {
        index = newIndex;
        item.dataset.index = newIndex;
        item.querySelector('.item-title').textContent = `${newIndex}`;
        updateDB();
    };

    item.getCurrentState = () => {
        return {
            file: currentFile,
            fileName: currentFileName,
            volume: baseVolume,
            mcVolume: mcVolume,
            loop: audio.loop
        };
    };

    // 他の音を止めるメソッドと排他制御
    item.stopAudio = () => {
        clearInterval(fadeInterval);
        audio.pause();
        audio.currentTime = 0;
    };

    const handleExclusivePlay = () => {
        if (!overlapPlayStates[secId]) {
            const allItems = document.querySelectorAll('.sound-item');
            allItems.forEach(otherItem => {
                if (otherItem === item) return;
                const classes = Array.from(otherItem.classList);
                const secClass = classes.find(c => c.endsWith('-item') && c !== 'sound-item' && c !== 'pad-item');
                if (secClass) {
                    const otherSecId = secClass.replace('-item', '');
                    if (!overlapPlayStates[otherSecId] && otherItem.stopAudio) {
                        otherItem.stopAudio();
                    }
                }
            });
        }
    };

    // コピー・移動処理
    const copyMoveBtn = item.querySelector('.copy-move-btn');
    if (copyMoveBtn) {
        copyMoveBtn.addEventListener('click', async () => {
            let optionsHtml = '';
            sections.forEach(s => {
                optionsHtml += `<option value="${s.id}" ${s.id === secId ? 'selected' : ''}>${s.title}</option>`;
            });
            
            const result = await showCopyMoveModal(optionsHtml);
            if (!result) return;

            const targetSecId = result.secId;
            const action = result.action;
            const state = item.getCurrentState();

            const targetSec = sections.find(s => s.id === targetSecId);
            if (!targetSec) return;

            if (action === 'move') {
                item.stopAudio();
                item.remove();
                await reindexItems(secId);
            }

            sectionCounts[targetSecId]++;
            const newContainer = document.getElementById(`${targetSecId}-container`);
            if (newContainer) {
                createItem(sectionCounts[targetSecId], targetSecId, targetSec.style, newContainer, state);
                await reindexItems(targetSecId);
            }
            
            // DOM更新待ち
            setTimeout(() => {
                customAlert(action === 'move' ? '移動しました！' : 'コピーしました！');
            }, 100);
        });
    }

    deleteBtn.addEventListener('click', async () => {
        const ok = await customConfirm('この枠を削除しますか？');
        if (ok) {
            item.stopAudio();
            item.remove();
            await reindexItems(secId);
        }
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            currentFile = file;
            currentFileName = file.name;
            fileDisplay.textContent = currentFileName;
            audio.src = URL.createObjectURL(file);
            updateDB();
        }
    });

    if (repeatCheck) {
        repeatCheck.addEventListener('change', (e) => {
            audio.loop = e.target.checked;
            updateDB();
        });
    }

    volSlider.addEventListener('input', (e) => {
        baseVolume = parseFloat(e.target.value);
        if (!isMCMode) {
            audio.volume = baseVolume;
        }
        updateDB();
    });

    if (mcVolSlider) {
        mcVolSlider.addEventListener('input', (e) => {
            mcVolume = parseFloat(e.target.value);
            if (isMCMode) {
                audio.volume = mcVolume;
            }
            updateDB();
        });
    }

    audio.addEventListener('play', () => item.classList.add('playing'));
    audio.addEventListener('pause', () => item.classList.remove('playing'));
    
    audio.addEventListener('ended', () => {
        item.classList.remove('playing');
        
        if (!audio.loop) {
            if (autoPlayStates[secId]) {
                const nextIndex = index + 1;
                const items = document.querySelectorAll(`.${secId}-item`);
                for (let i = 0; i < items.length; i++) {
                    if (parseInt(items[i].dataset.index) === nextIndex) {
                        const nextPlayBtn = items[i].querySelector('.play-btn');
                        if (nextPlayBtn) nextPlayBtn.click();
                        break;
                    }
                }
            }
        }
    });

    playBtn.addEventListener('click', async () => {
        if (!audio.src || !currentFile) return await customAlert("音声ファイルを選択してください。");
        handleExclusivePlay();
        clearInterval(fadeInterval);
        isMCMode = false;
        if (mcBtn) mcBtn.classList.remove('active-btn');
        audio.currentTime = 0;
        audio.volume = baseVolume;
        audio.play().catch(console.error);
    });

    stopBtn.addEventListener('click', () => {
        item.stopAudio();
    });

    if (fadeInBtn) {
        fadeInBtn.addEventListener('click', async () => {
            if (!audio.src || !currentFile) return await customAlert("音声ファイルを選択してください。");
            handleExclusivePlay();
            clearInterval(fadeInterval);
            audio.volume = 0;
            audio.play().catch(console.error);

            fadeInterval = setInterval(() => {
                if (audio.volume < baseVolume - 0.05) {
                    audio.volume += 0.05;
                } else {
                    audio.volume = baseVolume;
                    clearInterval(fadeInterval);
                }
            }, 200);
        });
    }

    if (fadeOutBtn) {
        fadeOutBtn.addEventListener('click', () => {
            clearInterval(fadeInterval);
            fadeInterval = setInterval(() => {
                if (audio.volume > 0.05) {
                    audio.volume -= 0.05;
                } else {
                    audio.volume = 0;
                    audio.pause();
                    audio.currentTime = 0;
                    clearInterval(fadeInterval);
                }
            }, 200);
        });
    }

    if (mcBtn) {
        mcBtn.addEventListener('click', () => {
            clearInterval(fadeInterval);
            isMCMode = !isMCMode;
            
            if (isMCMode) {
                mcBtn.classList.add('active-btn');
                const targetVolume = mcVolume;
                fadeInterval = setInterval(() => {
                    if (audio.volume > targetVolume + 0.05) {
                        audio.volume -= 0.05;
                    } else if (audio.volume < targetVolume - 0.05) {
                        audio.volume += 0.05;
                    } else {
                        audio.volume = targetVolume;
                        clearInterval(fadeInterval);
                    }
                }, 100);
            } else {
                mcBtn.classList.remove('active-btn');
                fadeInterval = setInterval(() => {
                    if (audio.volume < baseVolume - 0.05) {
                        audio.volume += 0.05;
                    } else if (audio.volume > baseVolume + 0.05) {
                        audio.volume -= 0.05;
                    } else {
                        audio.volume = baseVolume;
                        clearInterval(fadeInterval);
                    }
                }, 100);
            }
        });
    }

    enableDragAndDrop(item, container, secId);
    container.appendChild(item);
}

// --- リセット機能 ---
function initResetButton() {
    const resetBtn = document.getElementById('reset-btn');
    if (!resetBtn) return;

    resetBtn.addEventListener('click', async () => {
        const ok1 = await customConfirm('アプリをデフォルト状態に戻しますか？\n設定した音声ファイル・欄の構成・メモ・テンプレートがすべて削除されます。');
        if (!ok1) return;
        const ok2 = await customConfirm('本当によろしいですか？\nこの操作は元に戻せません。');
        if (!ok2) return;

        // IndexedDB を全消去
        if (db) {
            const txAudio = db.transaction([STORE_NAME_AUDIO], 'readwrite');
            txAudio.objectStore(STORE_NAME_AUDIO).clear();
            const txSec = db.transaction([STORE_NAME_SECTION], 'readwrite');
            txSec.objectStore(STORE_NAME_SECTION).clear();
        }

        // localStorage を全消去
        localStorage.removeItem(MEMO_STORAGE_KEY);
        localStorage.removeItem(TEMPLATE_STORAGE_KEY);
        localStorage.removeItem('pondashi_overlap_states');
        localStorage.removeItem('pondashi_volume_migration_v1');

        await customAlert('デフォルトに戻しました！\n画面を更新します。');
        location.reload();
    });
}

// --- データ引き継ぎ（エクスポート・インポート）機能 ---
function initDataTransfer() {
    const exportBtn = document.getElementById('export-btn');
    const importInput = document.getElementById('import-file');

    if (!exportBtn || !importInput) return;

    // 書き出し機能
    exportBtn.addEventListener('click', async () => {
        try {
            exportBtn.textContent = "書き出し中...";
            exportBtn.disabled = true;

            const allSections = await getAllSections();
            const allAudioData = await getAllData();
            
            // FileオブジェクトをBase64(Data URL)に変換する関数
            const fileToBase64 = (file) => {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = error => reject(error);
                });
            };

            // 音声ファイルをBase64に変換して抽出（※ファイルが多いと重くなります）
            const audioDataWithFiles = await Promise.all(allAudioData.map(async data => {
                let fileDataUrl = null;
                if (data.file) {
                    try {
                        fileDataUrl = await fileToBase64(data.file);
                    } catch (e) {
                        console.warn("ファイル変換エラー:", e);
                    }
                }
                return {
                    id: data.id,
                    fileDataUrl: fileDataUrl, // Base64文字列として保存
                    fileName: data.fileName,
                    volume: data.volume,
                    loop: data.loop,
                    mcVolume: data.mcVolume
                };
            }));

            const memo = localStorage.getItem(MEMO_STORAGE_KEY) || "";
            const templates = localStorage.getItem(TEMPLATE_STORAGE_KEY) || "[]";

            const exportObj = {
                sections: allSections,
                audioData: audioDataWithFiles,
                memo: memo,
                templates: JSON.parse(templates)
            };

            // JSON文字列にする（サイズが巨大になる可能性がある）
            const jsonString = JSON.stringify(exportObj);
            
            // Blobを作成してダウンロード（巨大ファイル対応のため Blob を使用）
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", url);
            downloadAnchorNode.setAttribute("download", "pondashi_backup_with_audio.json");
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            document.body.removeChild(downloadAnchorNode);
            URL.revokeObjectURL(url);
            
        } catch (e) {
            console.error("エクスポートエラー", e);
            await customAlert("データの書き出しに失敗しました。ファイルが大きすぎる可能性があります。");
        } finally {
            exportBtn.textContent = "書き出し";
            exportBtn.disabled = false;
        }
    });

    // 読み込み機能
    importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // 読み込み中表示
        const labelEl = importInput.parentElement;
        const originalText = labelEl.innerHTML;
        labelEl.innerHTML = "読み込み中...";

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const importedObj = JSON.parse(event.target.result);
                
                if (!importedObj.sections || !importedObj.audioData) {
                    throw new Error("無効なファイルフォーマットです。");
                }

                const ok = await customConfirm("現在の設定や欄はすべて上書きされます。よろしいですか？\n※音声データが含まれる場合、復元に数秒かかることがあります。");
                if (!ok) {
                    importInput.value = "";
                    labelEl.innerHTML = originalText;
                    return;
                }

                // Base64 から File オブジェクトを復元する関数
                const dataUrlToFile = (dataUrl, filename) => {
                    const arr = dataUrl.split(',');
                    const mime = arr[0].match(/:(.*?);/)[1];
                    const bstr = atob(arr[1]);
                    let n = bstr.length;
                    const u8arr = new Uint8Array(n);
                    while(n--){
                        u8arr[n] = bstr.charCodeAt(n);
                    }
                    return new File([u8arr], filename, {type: mime});
                };

                if (db) {
                    // セクションの復元
                    const txSec = db.transaction([STORE_NAME_SECTION], 'readwrite');
                    txSec.objectStore(STORE_NAME_SECTION).clear();
                    importedObj.sections.forEach(s => {
                        txSec.objectStore(STORE_NAME_SECTION).put(s);
                    });

                    // オーディオ設定の復元
                    const txAudio = db.transaction([STORE_NAME_AUDIO], 'readwrite');
                    txAudio.objectStore(STORE_NAME_AUDIO).clear();
                    
                    importedObj.audioData.forEach(a => {
                        let fileObj = null;
                        if (a.fileDataUrl) {
                            try {
                                fileObj = dataUrlToFile(a.fileDataUrl, a.fileName);
                            } catch(err) {
                                console.error("音声復元エラー", err);
                            }
                        } else if (a.file) {
                            // 古いバージョンのバックアップ対策
                            fileObj = null;
                        }
                        
                        txAudio.objectStore(STORE_NAME_AUDIO).put({
                            id: a.id,
                            file: fileObj, // 復元した音声ファイルをセット
                            fileName: a.fileName,
                            volume: a.volume,
                            loop: a.loop,
                            mcVolume: a.mcVolume
                        });
                    });
                }

                // メモ・テンプレートの復元
                if (importedObj.memo !== undefined) {
                    localStorage.setItem(MEMO_STORAGE_KEY, importedObj.memo);
                }
                if (importedObj.templates !== undefined) {
                    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(importedObj.templates));
                }

                await customAlert("データの読み込みが完了しました！\n画面を更新します。");
                location.reload();
                
            } catch (error) {
                console.error("インポートエラー", error);
                await customAlert("ファイルの読み込みに失敗しました。ファイルが大きすぎるか、破損しています。");
                labelEl.innerHTML = originalText;
            }
            importInput.value = "";
        };
        reader.readAsText(file);
    });
}
