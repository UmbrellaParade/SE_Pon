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

// --- メモ＆テンプレート機能 ---
let templates = [];
const MEMO_STORAGE_KEY = 'pondashi_current_memo';
const TEMPLATE_STORAGE_KEY = 'pondashi_templates';

function initMemo() {
    const memoArea = document.getElementById('memo-area');
    const templateSelect = document.getElementById('template-select');
    const loadBtn = document.getElementById('load-template-btn');
    const saveBtn = document.getElementById('save-template-btn');
    const updateBtn = document.getElementById('update-template-btn');
    const deleteBtn = document.getElementById('delete-template-btn');

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
    loadBtn.addEventListener('click', () => {
        const id = templateSelect.value;
        if (!id) return alert('読み込むテンプレートを選択してください。');
        const t = templates.find(x => x.id === id);
        if (t) {
            if (memoArea.value.trim() !== '' && !confirm('現在のメモが上書きされます。よろしいですか？')) return;
            memoArea.value = t.content;
            localStorage.setItem(MEMO_STORAGE_KEY, memoArea.value);
        }
    });

    // 新規保存
    saveBtn.addEventListener('click', () => {
        if (memoArea.value.trim() === '') return alert('メモが空です。保存する内容を入力してください。');
        const name = prompt('新しいテンプレートの名前を入力してください\n（例: 雑談枠用、ゲーム配信枠用 など）');
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
        alert(`テンプレート「${newTemplate.name}」を保存しました！`);
    });

    // 上書き保存
    updateBtn.addEventListener('click', () => {
        const id = templateSelect.value;
        if (!id) return alert('上書きするテンプレートをプルダウンから選択してください。');
        if (memoArea.value.trim() === '') return alert('メモが空です。');
        
        const t = templates.find(x => x.id === id);
        if (t && confirm(`「${t.name}」を現在のメモ内容で上書きしますか？`)) {
            t.content = memoArea.value;
            localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
            alert('上書き保存しました！');
        }
    });

    // 削除
    deleteBtn.addEventListener('click', () => {
        const id = templateSelect.value;
        if (!id) return alert('削除するテンプレートを選択してください。');
        
        const t = templates.find(x => x.id === id);
        if (t && confirm(`本当にテンプレート「${t.name}」を削除しますか？`)) {
            templates = templates.filter(x => x.id !== id);
            localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
            renderTemplateOptions();
            alert('テンプレートを削除しました。');
        }
    });
}

const DEFAULT_SECTIONS = [
  { id: "bgm", title: "🎵 曲・BGM", style: "bgm", order: 1, isCollapsed: false },
  { id: "jingle1", title: "📢 ジングル・CM 1", style: "bgm", order: 2, isCollapsed: false },
  { id: "jingle2", title: "📢 ジングル・CM 2", style: "bgm", order: 3, isCollapsed: false },
  { id: "se", title: "💥 効果音 (SE)", style: "pad", order: 4, isCollapsed: false },
  { id: "originalOke", title: "🎤 オリジナルオケ", style: "bgm", order: 5, isCollapsed: false },
  { id: "coverOke", title: "🎤 カバーオケ", style: "bgm", order: 6, isCollapsed: false },
  { id: "jingleOther", title: "📢 CMその他（緊急用等）", style: "bgm", order: 7, isCollapsed: false },
  { id: "other", title: "🎵 その他（緊急用等）", style: "bgm", order: 8, isCollapsed: false }
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

        const savedAudioData = await getAllData();
        
        sections.forEach(sec => {
            sectionCounts[sec.id] = 0;
            autoPlayStates[sec.id] = false;
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

        document.getElementById('add-section-btn').addEventListener('click', () => {
            const title = prompt("新しい欄の名前を入力してください\n（例: 「🎤 ゲスト用BGM」「📢 特殊効果音」など）");
            if (!title || title.trim() === '') return;
            
            const newId = 'custom_' + Date.now();
            const newOrder = sections.length > 0 ? Math.max(...sections.map(s => s.order)) + 1 : 1;
            const newSec = { id: newId, title: title, style: 'bgm', order: newOrder, isCollapsed: false };
            
            sections.push(newSec);
            sectionCounts[newId] = 0;
            autoPlayStates[newId] = false;
            saveSection(newId, title, 'bgm', newOrder, false);
            
            appendSectionDOM(newSec, []);
        });
    } catch (e) {
        console.error("データベースエラー", e);
    }
});

function renderAllSections(savedAudioData) {
    const container = document.getElementById('sections-container');
    container.innerHTML = '';
    sections.forEach(sec => {
        appendSectionDOM(sec, savedAudioData);
    });
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
                    <button class="add-btn" data-sec="${sec.id}" style="padding:4px 8px; font-size:0.8em; margin-left:10px;">+ 枠を増やす</button>
                    <label style="font-size: 0.7em; font-weight: normal; cursor: pointer; color: var(--text-color); margin-left:10px;" title="この設定は自動保存されません。配信ごとにチェックしてください。">
                        <input type="checkbox" class="auto-play-check" data-sec="${sec.id}"> 自動連続再生（プレイリスト）
                    </label>
                </h2>
            </div>
            <button class="delete-sec-btn" data-sec="${sec.id}" style="background:none; border:none; color:#ff5555; cursor:pointer; font-size:0.85em; text-decoration:underline; white-space:nowrap;">🗑️ 欄ごと削除</button>
        </div>
        <div id="${sec.id}-container" class="grid-container ${sec.style === 'pad' ? 'pad-grid' : 'bgm-grid'}" style="display: ${sec.isCollapsed ? 'none' : 'grid'};">
        </div>
    `;
    mainContainer.appendChild(sectionEl);

    const itemsContainer = document.getElementById(`${sec.id}-container`);
    const toggleBtn = sectionEl.querySelector('.collapse-toggle');

    // タイトル編集イベント
    const editTitleHandler = () => {
        const newTitle = prompt("欄の新しい名前を入力してください", sec.title);
        if (newTitle !== null && newTitle.trim() !== "") {
            sec.title = newTitle.trim();
            sectionEl.querySelector('.section-title-text').textContent = sec.title;
            saveSection(sec.id, sec.title, sec.style, sec.order, sec.isCollapsed);
            updateItemTitles(sec.id);
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

    sectionEl.querySelector('.delete-sec-btn').addEventListener('click', async () => {
        if (confirm(`本当に「${sec.title}」の欄を削除しますか？\nセットされている音声データもすべて消去されます。`)) {
            await clearDataByType(sec.id);
            deleteSectionFromDB(sec.id);
            sections = sections.filter(s => s.id !== sec.id);
            delete sectionCounts[sec.id];
            delete autoPlayStates[sec.id];
            sectionEl.remove();
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
    const secInfo = sections.find(s => s.id === secId);
    if (!secInfo) return;
    const secTitleBase = secInfo.title.replace(/（.*）/, '').trim();
    const items = document.querySelectorAll(`.${secId}-item`);
    items.forEach(item => {
        const idx = item.dataset.index;
        const titleEl = item.querySelector('.item-title');
        if (titleEl) {
            titleEl.textContent = `${secTitleBase} ${idx}`;
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
    let baseVolume = initialData?.volume !== undefined ? initialData.volume : 0.5;
    let mcVolume = initialData?.mcVolume !== undefined ? initialData.mcVolume : 0.1;
    let currentFile = initialData?.file || null;
    let currentFileName = initialData?.fileName || 'ファイル未選択';
    audio.loop = initialData?.loop || false;

    if (currentFile) {
        audio.src = URL.createObjectURL(currentFile);
    }

    const secInfo = sections.find(s => s.id === secId);
    const secTitleBase = secInfo ? secInfo.title.replace(/（.*）/, '').trim() : 'アイテム';
    let titleText = `${secTitleBase} ${index}`;

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
            <div>
                <label><input type="checkbox" class="repeat-check" ${audio.loop ? 'checked' : ''}> リピート</label>
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
        <div class="controls">
            <button class="fade-in-btn">↗ フェードイン</button>
            <button class="fade-out-btn">↘ フェードアウト</button>
            ${mcBtnHtml}
        </div>
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
        item.querySelector('.item-title').textContent = `${secTitleBase} ${newIndex}`;
        updateDB();
    };

    deleteBtn.addEventListener('click', async () => {
        if (confirm('この枠を削除しますか？')) {
            clearInterval(fadeInterval);
            audio.pause();
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

    repeatCheck.addEventListener('change', (e) => {
        audio.loop = e.target.checked;
        updateDB();
    });

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

    playBtn.addEventListener('click', () => {
        if (!audio.src || !currentFile) return alert("音声ファイルを選択してください。");
        clearInterval(fadeInterval);
        isMCMode = false;
        if (mcBtn) mcBtn.classList.remove('active-btn');
        audio.currentTime = 0;
        audio.volume = baseVolume;
        audio.play().catch(console.error);
    });

    stopBtn.addEventListener('click', () => {
        clearInterval(fadeInterval);
        audio.pause();
        audio.currentTime = 0;
    });

    fadeInBtn.addEventListener('click', () => {
        if (!audio.src || !currentFile) return alert("音声ファイルを選択してください。");
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
