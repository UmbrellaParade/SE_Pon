// --- IndexedDB の設定 ---
const DB_NAME = 'PonDashiAppDB';
const STORE_NAME_AUDIO = 'AudioFiles';
const STORE_NAME_SECTION = 'Sections';
const STORE_NAME_PRESET = 'Presets';
const STORE_NAME_BROADCAST_SET = 'BroadcastSets';
const DB_VERSION = 5;
let db;

const REQUIRED_STORES = [
    { name: STORE_NAME_AUDIO, options: { keyPath: 'id' } },
    { name: STORE_NAME_SECTION, options: { keyPath: 'id' } },
    { name: STORE_NAME_PRESET, options: { keyPath: 'id' } },
    { name: STORE_NAME_BROADCAST_SET, options: { keyPath: 'id' } },
];

function createMissingStores(database) {
    REQUIRED_STORES.forEach(({ name, options }) => {
        if (!database.objectStoreNames.contains(name)) {
            database.createObjectStore(name, options);
        }
    });
}

function getMissingStoreNames(database) {
    return REQUIRED_STORES
        .map(({ name }) => name)
        .filter(name => !database.objectStoreNames.contains(name));
}

function openPonDashiDB(version) {
    return new Promise((resolve, reject) => {
        const request = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            createMissingStores(db);
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject(e.target.error || e);
        request.onblocked = () => reject(new Error('IndexedDB upgrade blocked. Close other app tabs and reload.'));
    });
}

async function initDB() {
    try {
        db = await openPonDashiDB(DB_VERSION);
    } catch (e) {
        if (e?.name !== 'VersionError') throw e;
        // A newer trial version may have opened this DB. Reopen at its current version.
        db = await openPonDashiDB();
    }

    const missingStores = getMissingStoreNames(db);
    if (missingStores.length > 0) {
        const repairVersion = db.version + 1;
        console.warn('IndexedDB store repair:', missingStores.join(', '));
        db.close();
        db = await openPonDashiDB(repairVersion);
    }

    const stillMissing = getMissingStoreNames(db);
    if (stillMissing.length > 0) {
        throw new Error(`IndexedDB stores are missing: ${stillMissing.join(', ')}`);
    }
}

function resetToDefaultSections() {
    return DEFAULT_SECTIONS.map(section => ({ ...section }));
}

function initSectionControls() {
    const addSectionBtn = document.getElementById('add-section-btn');
    const addSeSectionBtn = document.getElementById('add-se-section-btn');

    if (addSectionBtn && addSectionBtn.dataset.initialized !== '1') {
        addSectionBtn.dataset.initialized = '1';
        addSectionBtn.addEventListener('click', async () => {
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
    }

    if (addSeSectionBtn && addSeSectionBtn.dataset.initialized !== '1') {
        addSeSectionBtn.dataset.initialized = '1';
        addSeSectionBtn.addEventListener('click', async () => {
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
    }
}

async function startWithDefaultViewAfterDBError(error) {
    console.error("データベースエラー", error);
    db = null;
    sections = resetToDefaultSections();
    sectionCounts = {};
    autoPlayStates = {};

    sections.forEach(sec => {
        sectionCounts[sec.id] = 0;
        autoPlayStates[sec.id] = false;
        if (overlapPlayStates[sec.id] === undefined) overlapPlayStates[sec.id] = (sec.style === 'pad');
        if (navVisibilityStates[sec.id] === undefined) navVisibilityStates[sec.id] = true;
    });

    renderAllSections([]);
    initSectionControls();
    initResetButton();
    initGlobalVolume();

    await customAlert(
        "オンライン版の保存データ読み込みに失敗したため、デフォルト画面で起動しました。\n" +
        "復元する場合は、アプリをデフォルトに戻して再読み込みしてから、完全バックアップJSONを読み込んでください。\n" +
        "この表示が続く場合は、オンライン版を開いている他のタブを閉じてから再読み込みしてください。"
    );
}

function deleteAppDatabase() {
    return new Promise((resolve) => {
        try {
            if (db) {
                db.close();
                db = null;
            }

            const request = indexedDB.deleteDatabase(DB_NAME);
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => {
                console.error('IndexedDB削除エラー', e.target.error);
                resolve(false);
            };
            request.onblocked = () => {
                console.warn('IndexedDB削除がブロックされました。別タブでアプリが開いている可能性があります。');
                resolve(false);
            };
        } catch(e) {
            console.error('IndexedDB削除エラー', e);
            resolve(false);
        }
    });
}

function saveData(id, file, fileName, volume, loop, mcVolume = 0.1) {
    return new Promise((resolve) => {
        if (!db) {
            console.error('音声保存エラー: DB not initialized');
            return resolve(false);
        }

        try {
            const transaction = db.transaction([STORE_NAME_AUDIO], 'readwrite');
            const store = transaction.objectStore(STORE_NAME_AUDIO);
            store.put({ id, file, fileName, volume, loop, mcVolume });
            transaction.oncomplete = () => resolve(true);
            transaction.onerror = (e) => {
                console.error('音声保存エラー', e.target.error);
                resolve(false);
            };
            transaction.onabort = (e) => {
                console.error('音声保存中断', e.target.error);
                resolve(false);
            };
        } catch(e) {
            console.error('音声保存エラー', e);
            resolve(false);
        }
    });
}

function getAllData() {
    return new Promise((resolve) => {
        try {
            if (!db || !db.objectStoreNames.contains(STORE_NAME_AUDIO)) return resolve([]);
            const transaction = db.transaction([STORE_NAME_AUDIO], 'readonly');
            const store = transaction.objectStore(STORE_NAME_AUDIO);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (e) => {
                console.error('音声データ読み込みエラー', e.target.error);
                resolve([]);
            };
            transaction.onerror = (e) => {
                console.error('音声データ読み込みエラー', e.target.error);
                resolve([]);
            };
        } catch(e) {
            console.error('音声データ読み込みエラー', e);
            resolve([]);
        }
    });
}

function clearDataByType(typePrefix) {
    return new Promise((resolve) => {
        try {
            if (!db || !db.objectStoreNames.contains(STORE_NAME_AUDIO)) return resolve();
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
            request.onerror = (e) => {
                console.error('音声データ削除エラー', e.target.error);
                resolve();
            };
            transaction.onerror = (e) => {
                console.error('音声データ削除エラー', e.target.error);
                resolve();
            };
        } catch(e) {
            console.error('音声データ削除エラー', e);
            resolve();
        }
    });
}

function saveSection(id, title, style, order, isCollapsed = false) {
    if (!db || !db.objectStoreNames.contains(STORE_NAME_SECTION)) return false;
    try {
        const tx = db.transaction([STORE_NAME_SECTION], 'readwrite');
        tx.objectStore(STORE_NAME_SECTION).put({ id, title, style, order, isCollapsed });
        tx.onerror = (e) => console.error('欄保存エラー', e.target.error);
        return true;
    } catch(e) {
        console.error('欄保存エラー', e);
        return false;
    }
}

function getAllSections() {
    return new Promise((resolve) => {
        try {
            if (!db || !db.objectStoreNames.contains(STORE_NAME_SECTION)) return resolve([]);
            const tx = db.transaction([STORE_NAME_SECTION], 'readonly');
            const req = tx.objectStore(STORE_NAME_SECTION).getAll();
            req.onsuccess = () => {
                let res = (req.result || []).filter(section => section && section.id);
                res.sort((a, b) => (a.order || 0) - (b.order || 0));
                resolve(res);
            };
            req.onerror = (e) => {
                console.error('欄読み込みエラー', e.target.error);
                resolve([]);
            };
            tx.onerror = (e) => {
                console.error('欄読み込みエラー', e.target.error);
                resolve([]);
            };
        } catch(e) {
            console.error('欄読み込みエラー', e);
            resolve([]);
        }
    });
}

function deleteSectionFromDB(id) {
    if (!db || !db.objectStoreNames.contains(STORE_NAME_SECTION)) return;
    try {
        const tx = db.transaction([STORE_NAME_SECTION], 'readwrite');
        tx.objectStore(STORE_NAME_SECTION).delete(id);
        tx.onerror = (e) => console.error('欄削除エラー', e.target.error);
    } catch(e) {
        console.error('欄削除エラー', e);
    }
}

// --- プリセット用DB操作 ---
function savePresetToDB(preset) {
    return new Promise((resolve, reject) => {
        if (!db || !db.objectStoreNames.contains(STORE_NAME_PRESET)) return reject(new Error('DB not initialized'));
        try {
            const tx = db.transaction([STORE_NAME_PRESET], 'readwrite');
            tx.objectStore(STORE_NAME_PRESET).put(preset);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error || e);
        } catch(e) {
            reject(e);
        }
    });
}

function getAllPresets() {
    return new Promise((resolve) => {
        try {
            if (!db || !db.objectStoreNames.contains(STORE_NAME_PRESET)) return resolve([]);
            const tx = db.transaction([STORE_NAME_PRESET], 'readonly');
            const req = tx.objectStore(STORE_NAME_PRESET).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = (e) => {
                console.error('プリセット読み込みエラー', e.target.error);
                resolve([]);
            };
            tx.onerror = (e) => {
                console.error('プリセット読み込みエラー', e.target.error);
                resolve([]);
            };
        } catch(e) {
            console.error('プリセット読み込みエラー', e);
            resolve([]);
        }
    });
}

function deletePresetFromDB(id) {
    return new Promise((resolve, reject) => {
        if (!db || !db.objectStoreNames.contains(STORE_NAME_PRESET)) return resolve();
        try {
            const tx = db.transaction([STORE_NAME_PRESET], 'readwrite');
            tx.objectStore(STORE_NAME_PRESET).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error || e);
        } catch(e) {
            reject(e);
        }
    });
}

// --- 配信セット用DB操作 ---
function saveBroadcastSetToDB(broadcastSet) {
    return new Promise((resolve, reject) => {
        if (!db || !db.objectStoreNames.contains(STORE_NAME_BROADCAST_SET)) return reject(new Error('DB not initialized'));
        try {
            const tx = db.transaction([STORE_NAME_BROADCAST_SET], 'readwrite');
            tx.objectStore(STORE_NAME_BROADCAST_SET).put(broadcastSet);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error || e);
        } catch(e) {
            reject(e);
        }
    });
}

function getAllBroadcastSets() {
    return new Promise((resolve) => {
        try {
            if (!db || !db.objectStoreNames.contains(STORE_NAME_BROADCAST_SET)) return resolve([]);
            const tx = db.transaction([STORE_NAME_BROADCAST_SET], 'readonly');
            const req = tx.objectStore(STORE_NAME_BROADCAST_SET).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = (e) => {
                console.error('配信セット読み込みエラー', e.target.error);
                resolve([]);
            };
            tx.onerror = (e) => {
                console.error('配信セット読み込みエラー', e.target.error);
                resolve([]);
            };
        } catch(e) {
            console.error('配信セット読み込みエラー', e);
            resolve([]);
        }
    });
}

function deleteBroadcastSetFromDB(id) {
    return new Promise((resolve, reject) => {
        if (!db || !db.objectStoreNames.contains(STORE_NAME_BROADCAST_SET)) return resolve();
        try {
            const tx = db.transaction([STORE_NAME_BROADCAST_SET], 'readwrite');
            tx.objectStore(STORE_NAME_BROADCAST_SET).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error || e);
        } catch(e) {
            reject(e);
        }
    });
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

function loadTemplatesFromStorage() {
    const savedTemplates = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!savedTemplates) {
        templates = [];
        return templates;
    }

    try {
        const parsedTemplates = JSON.parse(savedTemplates);
        templates = Array.isArray(parsedTemplates) ? parsedTemplates : [];
    } catch(e) {
        templates = [];
    }

    return templates;
}

function saveTemplatesToStorage() {
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
}

function renderTemplateOptions(selectedId = '') {
    const templateSelect = document.getElementById('template-select');
    if (!templateSelect) return;

    templateSelect.innerHTML = '<option value="">-- テンプレートを選択 --</option>';
    templates.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name;
        templateSelect.appendChild(opt);
    });

    if (selectedId) {
        templateSelect.value = selectedId;
    }
}

function createMemoTemplate(name, content) {
    const newTemplate = {
        id: 'tpl_' + Date.now(),
        name: name.trim(),
        content
    };

    templates.push(newTemplate);
    saveTemplatesToStorage();
    renderTemplateOptions(newTemplate.id);
    return newTemplate;
}

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
    loadTemplatesFromStorage();
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
        
        const newTemplate = createMemoTemplate(name.trim(), memoArea.value);
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
                saveTemplatesToStorage();
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
                saveTemplatesToStorage();
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
            sections = resetToDefaultSections();
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
        initSectionControls();

        initDataTransfer(); // データ引き継ぎ機能の初期化
        initResetButton();  // リセットボタンの初期化
        initGlobalVolume(); // 一括音量設定の初期化
        initPreset();       // プリセット機能の初期化
        initBroadcastSetSave(); // 配信セット保存の初期化
    } catch (e) {
        await startWithDefaultViewAfterDBError(e);
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
        btn.style.cssText = 'padding: 4px 14px; background: #1a3040; color: #80deea; border: 1px solid #2a7a8a; border-radius: 20px; cursor: pointer; font-size: 0.85em; white-space: nowrap; transition: background 0.2s, border-color 0.2s;';
        btn.addEventListener('mouseover', () => { btn.style.background = '#224455'; btn.style.borderColor = '#00bcd4'; });
        btn.addEventListener('mouseout', () => { btn.style.background = '#1a3040'; btn.style.borderColor = '#2a7a8a'; });
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
            <span style="margin-left:6px; font-size:0.9em; white-space:nowrap;">MC時</span>
            <button class="mc-vol-down-btn" style="padding:1px 5px; background:#555; color:#fff; border:none; border-radius:3px; cursor:pointer; font-size:0.75em; flex-shrink:0; line-height:1.4;">◀</button>
            <input type="range" min="0" max="1" step="0.01" value="${mcVolume}" class="mc-vol-slider" style="flex:none; width:48px;">
            <button class="mc-vol-up-btn" style="padding:1px 5px; background:#555; color:#fff; border:none; border-radius:3px; cursor:pointer; font-size:0.75em; flex-shrink:0; line-height:1.4;">▶</button>
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
        <div class="volume-control" style="gap:4px;">
            <span>音量</span>
            <button class="vol-down-btn" style="padding:1px 5px; background:#555; color:#fff; border:none; border-radius:3px; cursor:pointer; font-size:0.75em; flex-shrink:0; line-height:1.4;">◀</button>
            <input type="range" min="0" max="1" step="0.01" value="${baseVolume}" class="vol-slider">
            <button class="vol-up-btn" style="padding:1px 5px; background:#555; color:#fff; border:none; border-radius:3px; cursor:pointer; font-size:0.75em; flex-shrink:0; line-height:1.4;">▶</button>
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
        <div class="progress-section">
            <div class="progress-wrap" title="クリックで再生位置を移動できます">
                <div class="progress-bar-fill"></div>
            </div>
            <span class="time-display">--:--</span>
        </div>
    `;

    const fileInput = item.querySelector('.file-input');
    const fileDisplay = item.querySelector('.file-display');
    const playBtn = item.querySelector('.play-btn');
    const stopBtn = item.querySelector('.stop-btn');
    const fadeInBtn = item.querySelector('.fade-in-btn');
    const fadeOutBtn = item.querySelector('.fade-out-btn');
    const mcBtn = item.querySelector('.mc-btn');
    const progressWrap = item.querySelector('.progress-wrap');
    const progressFill = item.querySelector('.progress-bar-fill');
    const timeDisplay = item.querySelector('.time-display');
    const volSlider = item.querySelector('.vol-slider');
    const mcVolSlider = item.querySelector('.mc-vol-slider');
    const volDownBtn = item.querySelector('.vol-down-btn');
    const volUpBtn = item.querySelector('.vol-up-btn');
    const mcVolDownBtn = item.querySelector('.mc-vol-down-btn');
    const mcVolUpBtn = item.querySelector('.mc-vol-up-btn');
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

    // 時間フォーマット helper
    const formatTime = (sec) => {
        if (isNaN(sec) || !isFinite(sec)) return '--:--';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const resetProgress = () => {
        progressFill.style.width = '0%';
        timeDisplay.textContent = audio.duration ? `0:00 / ${formatTime(audio.duration)}` : '--:--';
        playBtn.textContent = '▶ 再生';
    };

    // 他の音を止めるメソッドと排他制御
    item.stopAudio = () => {
        clearInterval(fadeInterval);
        audio.pause();
        audio.currentTime = 0;
        resetProgress();
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

    const stepVol = (delta) => {
        baseVolume = Math.min(1, Math.max(0, Math.round((baseVolume + delta) * 100) / 100));
        volSlider.value = baseVolume;
        if (!isMCMode) audio.volume = baseVolume;
        updateDB();
    };
    const stepMcVol = (delta) => {
        mcVolume = Math.min(1, Math.max(0, Math.round((mcVolume + delta) * 100) / 100));
        if (mcVolSlider) mcVolSlider.value = mcVolume;
        if (isMCMode) audio.volume = mcVolume;
        updateDB();
    };
    volDownBtn?.addEventListener('click', () => stepVol(-0.01));
    volUpBtn?.addEventListener('click', () => stepVol(0.01));
    mcVolDownBtn?.addEventListener('click', () => stepMcVol(-0.01));
    mcVolUpBtn?.addEventListener('click', () => stepMcVol(0.01));

    audio.addEventListener('play', () => {
        item.classList.add('playing');
        playBtn.textContent = '▶ 再生中';
    });
    audio.addEventListener('pause', () => {
        item.classList.remove('playing');
        playBtn.textContent = '▶ 再生';
    });

    // 再生位置の更新
    audio.addEventListener('timeupdate', () => {
        if (audio.duration && !isNaN(audio.duration)) {
            const pct = (audio.currentTime / audio.duration) * 100;
            progressFill.style.width = pct + '%';
            timeDisplay.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
        }
    });

    // ファイル読み込み後に総時間を表示
    audio.addEventListener('loadedmetadata', () => {
        timeDisplay.textContent = `0:00 / ${formatTime(audio.duration)}`;
    });

    // プログレスバーをクリックしてシーク
    progressWrap.addEventListener('click', (e) => {
        if (!audio.duration || isNaN(audio.duration)) return;
        const rect = progressWrap.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        audio.currentTime = ratio * audio.duration;
    });

    audio.addEventListener('ended', () => {
        item.classList.remove('playing');
        resetProgress();

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

// --- 一括音量設定機能 ---
function initGlobalVolume() {
    const globalVolSlider    = document.getElementById('global-vol');
    const globalMcVolSlider  = document.getElementById('global-mc-vol');
    const globalVolDisplay   = document.getElementById('global-vol-display');
    const globalMcVolDisplay = document.getElementById('global-mc-vol-display');
    const applyBtn           = document.getElementById('global-vol-apply-btn');

    if (!globalVolSlider || !applyBtn) return;

    // スライダー操作中にパーセント表示を更新
    globalVolSlider.addEventListener('input', () => {
        globalVolDisplay.textContent = Math.round(parseFloat(globalVolSlider.value) * 100) + '%';
    });
    globalMcVolSlider.addEventListener('input', () => {
        globalMcVolDisplay.textContent = Math.round(parseFloat(globalMcVolSlider.value) * 100) + '%';
    });

    // 矢印ボタンで1%ずつ微調整
    const stepSlider = (slider, display, delta) => {
        const newVal = Math.max(0, Math.min(1, parseFloat(slider.value) + delta));
        slider.value = newVal.toFixed(2);
        display.textContent = Math.round(newVal * 100) + '%';
    };

    document.getElementById('global-vol-down')?.addEventListener('click',    () => stepSlider(globalVolSlider,   globalVolDisplay,   -0.01));
    document.getElementById('global-vol-up')?.addEventListener('click',      () => stepSlider(globalVolSlider,   globalVolDisplay,    0.01));
    document.getElementById('global-mc-vol-down')?.addEventListener('click', () => stepSlider(globalMcVolSlider, globalMcVolDisplay, -0.01));
    document.getElementById('global-mc-vol-up')?.addEventListener('click',   () => stepSlider(globalMcVolSlider, globalMcVolDisplay,  0.01));

    // 一括設定ボタン
    applyBtn.addEventListener('click', () => {
        const newVol   = parseFloat(globalVolSlider.value);
        const newMcVol = parseFloat(globalMcVolSlider.value);

        // 全ての音源スライダーに適用（既存のイベントリスナーを活かして音量・DB更新まで一括実行）
        document.querySelectorAll('.vol-slider').forEach(slider => {
            slider.value = newVol;
            slider.dispatchEvent(new Event('input'));
        });

        // 全てのMCスライダーに適用
        document.querySelectorAll('.mc-vol-slider').forEach(slider => {
            slider.value = newMcVol;
            slider.dispatchEvent(new Event('input'));
        });

        // ボタンで完了フィードバック（モーダルなし）
        applyBtn.textContent = '✓ 設定しました！';
        applyBtn.style.backgroundColor = '#4CAF50';
        setTimeout(() => {
            applyBtn.textContent = '一括設定';
            applyBtn.style.backgroundColor = '#2196F3';
        }, 1500);
    });
}

// --- リセット機能 ---
function initResetButton() {
    const resetBtn = document.getElementById('reset-btn');
    if (!resetBtn) return;

    resetBtn.addEventListener('click', async () => {
        const ok1 = await customConfirm('アプリをデフォルト状態に戻しますか？\n設定した音声ファイル・欄の構成・メモ・テンプレート・プリセット・配信セットがすべて削除されます。');
        if (!ok1) return;
        const ok2 = await customConfirm('本当によろしいですか？\nこの操作は元に戻せません。');
        if (!ok2) return;

        // IndexedDB を全消去
        const dbDeleted = await deleteAppDatabase();

        // localStorage を全消去
        localStorage.removeItem(MEMO_STORAGE_KEY);
        localStorage.removeItem(TEMPLATE_STORAGE_KEY);
        localStorage.removeItem('pondashi_overlap_states');
        localStorage.removeItem('pondashi_volume_migration_v1');
        localStorage.removeItem('pondashi_broadcast_set_migration_v1');

        if (!dbDeleted) {
            await customAlert('保存データの一部を削除できませんでした。\nオンライン版を開いている他のタブを閉じてから、もう一度お試しください。');
            return;
        }

        await customAlert('デフォルトに戻しました！\n画面を更新します。');
        location.reload();
    });
}

function getStoredObject(key) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch(e) {
        return {};
    }
}

async function buildScenePreset(name, basePreset = null) {
    const now = new Date().toISOString();
    const allSections  = await getAllSections();
    const allAudioData = await getAllData(); // Fileオブジェクトごと保存

    return {
        ...(basePreset || {}),
        id:            basePreset?.id || 'preset_' + Date.now(),
        name:          name.trim(),
        createdAt:     basePreset?.createdAt || now,
        updatedAt:     now,
        sections:      allSections,
        audioData:     allAudioData,
        overlapStates: getStoredObject('pondashi_overlap_states'),
        navVisibility: getStoredObject('pondashi_nav_visibility'),
    };
}

async function buildBroadcastSet(name, memoContent, baseSet = null) {
    const now = new Date().toISOString();
    const allSections  = await getAllSections();
    const allAudioData = await getAllData(); // Fileオブジェクトごと保存

    return {
        ...(baseSet || {}),
        id:            baseSet?.id || 'broadcast_set_' + Date.now(),
        name:          name.trim(),
        createdAt:     baseSet?.createdAt || now,
        updatedAt:     now,
        memo:          memoContent,
        sections:      allSections,
        audioData:     allAudioData,
        overlapStates: getStoredObject('pondashi_overlap_states'),
        navVisibility: getStoredObject('pondashi_nav_visibility'),
    };
}

function getTimestampFromId(id) {
    const match = String(id || '').match(/_(\d+)$/);
    return match ? Number(match[1]) : 0;
}

async function restoreSceneData(savedSet) {
    await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME_SECTION], 'readwrite');
        const store = tx.objectStore(STORE_NAME_SECTION);
        store.clear();
        (savedSet.sections || []).forEach(s => store.put(s));
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });

    await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME_AUDIO], 'readwrite');
        const store = tx.objectStore(STORE_NAME_AUDIO);
        store.clear();
        (savedSet.audioData || []).forEach(a => store.put(a));
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });

    if (savedSet.overlapStates) localStorage.setItem('pondashi_overlap_states', JSON.stringify(savedSet.overlapStates));
    if (savedSet.navVisibility) localStorage.setItem('pondashi_nav_visibility', JSON.stringify(savedSet.navVisibility));
}

async function migrateSplitBroadcastSetsOnce() {
    const MIGRATION_KEY = 'pondashi_broadcast_set_migration_v1';
    if (localStorage.getItem(MIGRATION_KEY) === '1') return;

    try {
        loadTemplatesFromStorage();
        const [existingSets, presets] = await Promise.all([getAllBroadcastSets(), getAllPresets()]);
        const existingNames = new Set(existingSets.map(s => s.name));
        const candidates = [];

        templates.forEach(template => {
            const templateTime = getTimestampFromId(template.id);
            if (!template.name || !templateTime || existingNames.has(template.name)) return;

            const matchingPreset = presets.find(p => {
                const presetTime = getTimestampFromId(p.id) || Date.parse(p.createdAt || '');
                return p.name === template.name &&
                       presetTime &&
                       Math.abs(presetTime - templateTime) <= 30 * 60 * 1000;
            });

            if (matchingPreset) {
                candidates.push({ template, preset: matchingPreset });
                existingNames.add(template.name);
            }
        });

        for (let i = 0; i < candidates.length; i++) {
            const { template, preset } = candidates[i];
            await saveBroadcastSetToDB({
                id: 'broadcast_set_migrated_' + Date.now() + '_' + i,
                name: template.name,
                createdAt: preset.createdAt || new Date(getTimestampFromId(template.id)).toISOString(),
                updatedAt: new Date().toISOString(),
                memo: template.content || '',
                sections: preset.sections || [],
                audioData: preset.audioData || [],
                overlapStates: preset.overlapStates || {},
                navVisibility: preset.navVisibility || {},
                migratedFromSplitSave: true
            });
        }
    } catch(e) {
        console.warn('配信セット移行エラー', e);
    } finally {
        localStorage.setItem(MIGRATION_KEY, '1');
    }
}

function initBroadcastSetSave() {
    const broadcastSetSelect = document.getElementById('broadcast-set-select');
    const loadSetBtn = document.getElementById('load-broadcast-set-btn');
    const saveSetBtn = document.getElementById('save-broadcast-set-btn');
    const updateSetBtn = document.getElementById('update-broadcast-set-btn');
    const deleteSetBtn = document.getElementById('delete-broadcast-set-btn');

    if (!broadcastSetSelect || !saveSetBtn) return;

    let broadcastSetList = [];

    async function loadBroadcastSets(selectedId = '') {
        await migrateSplitBroadcastSetsOnce();
        broadcastSetList = await getAllBroadcastSets();
        broadcastSetList.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        renderBroadcastSetOptions(selectedId);
    }

    function renderBroadcastSetOptions(selectedId = '') {
        broadcastSetSelect.innerHTML = '<option value="">-- セットを選択 --</option>';
        broadcastSetList.forEach(set => {
            const opt = document.createElement('option');
            opt.value = set.id;
            opt.textContent = set.name;
            broadcastSetSelect.appendChild(opt);
        });

        if (selectedId) {
            broadcastSetSelect.value = selectedId;
        }
    }

    saveSetBtn.addEventListener('click', async () => {
        const memoArea = document.getElementById('memo-area');
        if (!memoArea || memoArea.value.trim() === '') {
            await customAlert('メモが空です。保存する段取りメモを入力してください。');
            return;
        }

        const name = await customPrompt(
            '配信セットの名前を入力してください\nメモ・音源・欄構成をまとめて保存します。\n（例: 7/13 Sunoパ本番、ゲスト回用 など）'
        );
        if (!name || name.trim() === '') return;

        try {
            saveSetBtn.textContent = '保存中...';
            saveSetBtn.disabled = true;

            const trimmedName = name.trim();
            const broadcastSet = await buildBroadcastSet(trimmedName, memoArea.value);
            await saveBroadcastSetToDB(broadcastSet);
            await loadBroadcastSets(broadcastSet.id);

            await customAlert(`配信セット「${trimmedName}」を保存しました！`);
        } catch(e) {
            console.error('配信セット保存エラー', e);
            await customAlert('保存に失敗しました。\nエラー: ' + (e?.message || String(e)));
        } finally {
            saveSetBtn.textContent = '新規保存';
            saveSetBtn.disabled = false;
        }
    });

    updateSetBtn?.addEventListener('click', async () => {
        const id = broadcastSetSelect.value;
        if (!id) { await customAlert('上書きする配信セットを選択してください。'); return; }

        const memoArea = document.getElementById('memo-area');
        if (!memoArea || memoArea.value.trim() === '') {
            await customAlert('メモが空です。');
            return;
        }

        const currentSet = broadcastSetList.find(x => x.id === id);
        if (!currentSet) return;

        const ok = await customConfirm(`「${currentSet.name}」を現在のメモ・音源・欄構成で上書きしますか？`);
        if (!ok) return;

        try {
            updateSetBtn.textContent = '保存中...';
            updateSetBtn.disabled = true;

            const updated = await buildBroadcastSet(currentSet.name, memoArea.value, currentSet);
            await saveBroadcastSetToDB(updated);
            await loadBroadcastSets(id);
            await customAlert('上書き保存しました！');
        } catch(e) {
            console.error('配信セット上書きエラー', e);
            await customAlert('保存に失敗しました。\nエラー: ' + (e?.message || String(e)));
        } finally {
            updateSetBtn.textContent = '上書き';
            updateSetBtn.disabled = false;
        }
    });

    loadSetBtn?.addEventListener('click', async () => {
        const id = broadcastSetSelect.value;
        if (!id) { await customAlert('読み込む配信セットを選択してください。'); return; }

        const savedSet = broadcastSetList.find(x => x.id === id);
        if (!savedSet) return;

        const ok = await customConfirm(`「${savedSet.name}」を読み込みます。\n現在のメモ・音源・欄構成は上書きされます。よろしいですか？`);
        if (!ok) return;

        try {
            localStorage.setItem(MEMO_STORAGE_KEY, savedSet.memo || '');
            await restoreSceneData(savedSet);

            await customAlert(`「${savedSet.name}」を読み込みました！\n画面を更新します。`);
            location.reload();
        } catch(e) {
            console.error('配信セット読込エラー', e);
            await customAlert('読み込みに失敗しました。\nエラー: ' + (e?.message || String(e)));
        }
    });

    deleteSetBtn?.addEventListener('click', async () => {
        const id = broadcastSetSelect.value;
        if (!id) { await customAlert('削除する配信セットを選択してください。'); return; }

        const savedSet = broadcastSetList.find(x => x.id === id);
        if (!savedSet) return;

        const ok = await customConfirm(`本当に配信セット「${savedSet.name}」を削除しますか？`);
        if (!ok) return;

        await deleteBroadcastSetFromDB(id);
        await loadBroadcastSets();
        await customAlert('配信セットを削除しました。');
    });

    loadBroadcastSets();
}

// --- シーンプリセット機能 ---
function initPreset() {
    const presetSelect    = document.getElementById('preset-select');
    const loadPresetBtn   = document.getElementById('load-preset-btn');
    const savePresetBtn   = document.getElementById('save-preset-btn');
    const updatePresetBtn = document.getElementById('update-preset-btn');
    const deletePresetBtn = document.getElementById('delete-preset-btn');
    const presetToggle    = document.getElementById('preset-toggle');
    const presetBody      = document.getElementById('preset-body');
    const presetToggleIcon = document.getElementById('preset-toggle-icon');
    const PRESET_COLLAPSED_KEY = 'pondashi_preset_collapsed';

    if (!presetSelect) return;

    // 折りたたみ（サイドバー配置時のみ有効）
    if (presetToggle && presetBody && presetToggleIcon) {
        if (localStorage.getItem(PRESET_COLLAPSED_KEY) === '1') {
            presetBody.style.display = 'none';
            presetToggleIcon.textContent = '▶';
        }
        presetToggle.addEventListener('click', () => {
            const isCollapsed = presetBody.style.display === 'none';
            presetBody.style.display = isCollapsed ? 'block' : 'none';
            presetToggleIcon.textContent = isCollapsed ? '▼' : '▶';
            localStorage.setItem(PRESET_COLLAPSED_KEY, isCollapsed ? '0' : '1');
        });
    }

    let presetList = [];

    async function loadPresets() {
        presetList = await getAllPresets();
        // 作成日時の新しい順に並べる
        presetList.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        renderPresetOptions();
    }

    function renderPresetOptions() {
        presetSelect.innerHTML = '<option value="">-- プリセットを選択 --</option>';
        presetList.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            presetSelect.appendChild(opt);
        });
    }

    window.refreshPresetOptions = async (selectedPresetId = '') => {
        await loadPresets();
        if (selectedPresetId) {
            presetSelect.value = selectedPresetId;
        }
    };

    // 新規保存
    savePresetBtn.addEventListener('click', async () => {
        const name = await customPrompt(
            'プリセットの名前を入力してください\n（例: 5/30雑談枠、歌配信用、声劇用 など）'
        );
        if (!name || name.trim() === '') return;

        try {
            savePresetBtn.textContent = '保存中...';
            savePresetBtn.disabled = true;

            const preset = await buildScenePreset(name.trim());
            await savePresetToDB(preset);
            await loadPresets();
            presetSelect.value = preset.id;
            await customAlert(`プリセット「${preset.name}」を保存しました！`);
        } catch(e) {
            console.error('プリセット保存エラー', e);
            await customAlert('保存に失敗しました。\nエラー: ' + (e?.message || String(e)));
        } finally {
            savePresetBtn.textContent = '新規保存';
            savePresetBtn.disabled = false;
        }
    });

    // 上書き保存
    updatePresetBtn.addEventListener('click', async () => {
        const id = presetSelect.value;
        if (!id) { await customAlert('上書きするプリセットを選択してください。'); return; }
        const p = presetList.find(x => x.id === id);
        if (!p) return;

        const ok = await customConfirm(`「${p.name}」を現在の状態で上書きしますか？`);
        if (!ok) return;

        try {
            updatePresetBtn.textContent = '保存中...';
            updatePresetBtn.disabled = true;

            const updated = await buildScenePreset(p.name, p);
            await savePresetToDB(updated);
            await loadPresets();
            presetSelect.value = id;
            await customAlert('上書き保存しました！');
        } catch(e) {
            console.error('プリセット上書きエラー', e);
            await customAlert('保存に失敗しました。\nエラー: ' + (e?.message || String(e)));
        } finally {
            updatePresetBtn.textContent = '上書き';
            updatePresetBtn.disabled = false;
        }
    });

    // 読込
    loadPresetBtn.addEventListener('click', async () => {
        const id = presetSelect.value;
        if (!id) { await customAlert('読み込むプリセットを選択してください。'); return; }
        const p = presetList.find(x => x.id === id);
        if (!p) return;

        const ok = await customConfirm(`「${p.name}」を読み込みます。\n現在の設定はすべて上書きされます。よろしいですか？`);
        if (!ok) return;

        try {
            // セクションを復元
            await new Promise((resolve, reject) => {
                const tx = db.transaction([STORE_NAME_SECTION], 'readwrite');
                const store = tx.objectStore(STORE_NAME_SECTION);
                store.clear();
                p.sections.forEach(s => store.put(s));
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e);
            });

            // 音声データをFileオブジェクトごと復元
            await new Promise((resolve, reject) => {
                const tx = db.transaction([STORE_NAME_AUDIO], 'readwrite');
                const store = tx.objectStore(STORE_NAME_AUDIO);
                store.clear();
                p.audioData.forEach(a => store.put(a));
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e);
            });

            // 重ねて再生・目次表示の状態を復元
            if (p.overlapStates) localStorage.setItem('pondashi_overlap_states', JSON.stringify(p.overlapStates));
            if (p.navVisibility)  localStorage.setItem('pondashi_nav_visibility',  JSON.stringify(p.navVisibility));

            await customAlert(`「${p.name}」を読み込みました！\n画面を更新します。`);
            location.reload();
        } catch(e) {
            console.error('プリセット読込エラー', e);
            await customAlert('読み込みに失敗しました。\nエラー: ' + (e?.message || String(e)));
        }
    });

    // 削除
    deletePresetBtn.addEventListener('click', async () => {
        const id = presetSelect.value;
        if (!id) { await customAlert('削除するプリセットを選択してください。'); return; }
        const p = presetList.find(x => x.id === id);
        if (!p) return;

        const ok = await customConfirm(`本当にプリセット「${p.name}」を削除しますか？`);
        if (!ok) return;

        await deletePresetFromDB(id);
        await loadPresets();
        await customAlert('プリセットを削除しました。');
    });

    loadPresets();
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function dataUrlToFile(dataUrl, fileName = 'audio', type = '', lastModified = Date.now()) {
    const parts = dataUrl.split(',');
    const metaMatch = parts[0].match(/:(.*?);/);
    const mime = type || (metaMatch ? metaMatch[1] : 'application/octet-stream');
    const binary = atob(parts[1] || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], fileName, { type: mime, lastModified });
}

async function serializeAudioEntry(entry, fileLibrary) {
    const serialized = { ...entry };
    const fileObj = entry?.file;
    delete serialized.file;

    if (fileObj instanceof Blob) {
        const name = fileObj.name || entry.fileName || 'audio';
        const type = fileObj.type || '';
        const size = fileObj.size || 0;
        const lastModified = fileObj.lastModified || 0;
        const fileKey = [name, size, type, lastModified].join('|');

        if (!fileLibrary[fileKey]) {
            fileLibrary[fileKey] = {
                name,
                type,
                size,
                lastModified,
                dataUrl: await blobToDataUrl(fileObj)
            };
        }

        serialized.fileRef = fileKey;
        serialized.fileName = serialized.fileName || name;
    }

    return serialized;
}

async function serializeSceneLikeEntry(entry, fileLibrary) {
    const serialized = { ...entry };
    serialized.audioData = await Promise.all((entry.audioData || []).map(a => serializeAudioEntry(a, fileLibrary)));
    return serialized;
}

function deserializeAudioEntry(entry, fileLibrary) {
    const restored = { ...entry };
    let fileObj = null;

    if (entry.fileRef && fileLibrary?.[entry.fileRef]?.dataUrl) {
        const fileInfo = fileLibrary[entry.fileRef];
        fileObj = dataUrlToFile(fileInfo.dataUrl, fileInfo.name || entry.fileName, fileInfo.type || '', fileInfo.lastModified || Date.now());
    } else if (entry.fileDataUrl) {
        fileObj = dataUrlToFile(entry.fileDataUrl, entry.fileName || 'audio');
    }

    delete restored.fileRef;
    delete restored.fileDataUrl;
    restored.file = fileObj;
    restored.fileName = restored.fileName || fileObj?.name || '';
    return restored;
}

function restoreObjectStore(storeName, items) {
    return new Promise((resolve, reject) => {
        if (!db || !db.objectStoreNames.contains(storeName)) return resolve();

        const tx = db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        store.clear();
        (items || []).forEach(item => store.put(item));
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });
}

// --- データ引き継ぎ（エクスポート・インポート）機能 ---
function initDataTransfer() {
    const exportBtn = document.getElementById('export-btn');
    const importInput = document.getElementById('import-file');

    if (!exportBtn || !importInput) return;

    // 書き出し機能：音声ファイル本体も含めて、オンライン版へそのまま移せる完全バックアップを作る。
    exportBtn.addEventListener('click', async () => {
        try {
            exportBtn.textContent = "書き出し中...";
            exportBtn.disabled = true;

            const fileLibrary = {};
            const allSections = await getAllSections();
            const allAudioData = await getAllData();
            const presets = await getAllPresets();
            const broadcastSets = await getAllBroadcastSets();
            const serializedAudioData = await Promise.all(allAudioData.map(data => serializeAudioEntry(data, fileLibrary)));
            const serializedPresets = await Promise.all(presets.map(p => serializeSceneLikeEntry(p, fileLibrary)));
            const serializedBroadcastSets = await Promise.all(broadcastSets.map(s => serializeSceneLikeEntry(s, fileLibrary)));

            const memo = localStorage.getItem(MEMO_STORAGE_KEY) || "";

            let parsedTemplates = [];
            try {
                const templatesStr = localStorage.getItem(TEMPLATE_STORAGE_KEY);
                if (templatesStr) parsedTemplates = JSON.parse(templatesStr);
            } catch(e) { /* 壊れていても続行 */ }

            const exportObj = {
                version: 4,
                exportType: 'pondashi_full_backup',
                exportedAt: new Date().toISOString(),
                includesAudioFiles: true,
                files: fileLibrary,
                sections: allSections,
                audioData: serializedAudioData,
                presets: serializedPresets,
                broadcastSets: serializedBroadcastSets,
                memo,
                templates: parsedTemplates,
                overlapStates: getStoredObject('pondashi_overlap_states'),
                navVisibility: getStoredObject('pondashi_nav_visibility')
            };

            const jsonString = JSON.stringify(exportObj, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href     = url;
            a.download = 'pondashi_full_backup.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            await customAlert(
                '完全バックアップを書き出しました！\n' +
                'ダウンロードフォルダに「pondashi_full_backup.json」が保存されました。\n\n' +
                'オンライン版の「読み込み」からこのファイルを選ぶと、音源・プリセット・配信セット・メモを復元できます。'
            );

        } catch (e) {
            console.error("エクスポートエラー", e);
            await customAlert("書き出しに失敗しました。\nエラー: " + (e?.message || String(e)));
        } finally {
            exportBtn.textContent = "完全書き出し";
            exportBtn.disabled = false;
        }
    });

    // 読み込み機能
    importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const labelEl = importInput.parentElement;
        const originalText = labelEl.innerHTML;
        labelEl.innerHTML = "読み込み中...";

        const reader = new FileReader();
        reader.onerror = async () => {
            await customAlert("ファイルの読み込みに失敗しました。");
            labelEl.innerHTML = originalText;
            importInput.value = "";
        };
        reader.onload = async (event) => {
            try {
                const importedObj = JSON.parse(event.target.result);
                
                if (!importedObj.sections || !importedObj.audioData) {
                    throw new Error("無効なファイルフォーマットです。");
                }

                const ok = await customConfirm("現在の設定・プリセット・配信セットはすべて上書きされます。よろしいですか？");
                if (!ok) {
                    importInput.value = "";
                    labelEl.innerHTML = originalText;
                    return;
                }

                const fileLibrary = importedObj.files || {};
                const restoredAudioData = (importedObj.audioData || []).map(a => deserializeAudioEntry(a, fileLibrary));
                const restoredPresets = (importedObj.presets || []).map(p => ({
                    ...p,
                    audioData: (p.audioData || []).map(a => deserializeAudioEntry(a, fileLibrary))
                }));
                const restoredBroadcastSets = (importedObj.broadcastSets || []).map(s => ({
                    ...s,
                    audioData: (s.audioData || []).map(a => deserializeAudioEntry(a, fileLibrary))
                }));

                await restoreObjectStore(STORE_NAME_SECTION, importedObj.sections || []);
                await restoreObjectStore(STORE_NAME_AUDIO, restoredAudioData);
                await restoreObjectStore(STORE_NAME_PRESET, restoredPresets);
                await restoreObjectStore(STORE_NAME_BROADCAST_SET, restoredBroadcastSets);

                if (importedObj.memo !== undefined) {
                    localStorage.setItem(MEMO_STORAGE_KEY, importedObj.memo);
                }
                if (importedObj.templates !== undefined) {
                    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(importedObj.templates));
                }
                if (importedObj.overlapStates !== undefined) {
                    localStorage.setItem('pondashi_overlap_states', JSON.stringify(importedObj.overlapStates));
                }
                if (importedObj.navVisibility !== undefined) {
                    localStorage.setItem('pondashi_nav_visibility', JSON.stringify(importedObj.navVisibility));
                }
                localStorage.setItem('pondashi_broadcast_set_migration_v1', '1');

                const audioMessage = importedObj.includesAudioFiles
                    ? "音声ファイルも復元しました。"
                    : "音声ファイルは含まれていない形式のため、各枠で再選択してください。";

                await customAlert(`バックアップの読み込みが完了しました！\n${audioMessage}\n画面を更新します。`);
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
