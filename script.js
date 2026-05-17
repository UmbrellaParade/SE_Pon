document.addEventListener('DOMContentLoaded', () => {
    // 初期設定数
    let bgmCount = 20;
    let jingleCount = 10;
    let seCount = 10;

    const bgmContainer = document.getElementById('bgm-container');
    const jingleContainer = document.getElementById('jingle-container');
    const seContainer = document.getElementById('se-container');

    // 初期生成
    for (let i = 1; i <= bgmCount; i++) createBgmItem(i, bgmContainer);
    for (let i = 1; i <= jingleCount; i++) createPadItem(i, 'jingle', jingleContainer);
    for (let i = 1; i <= seCount; i++) createPadItem(i, 'se', seContainer);

    // 追加ボタンのイベント
    document.getElementById('add-bgm-btn').addEventListener('click', () => {
        bgmCount++;
        createBgmItem(bgmCount, bgmContainer);
    });
    
    document.getElementById('add-jingle-btn').addEventListener('click', () => {
        jingleCount++;
        createPadItem(jingleCount, 'jingle', jingleContainer);
    });

    document.getElementById('add-se-btn').addEventListener('click', () => {
        seCount++;
        createPadItem(seCount, 'se', seContainer);
    });
});

// BGMアイテムの生成
function createBgmItem(index, container) {
    const item = document.createElement('div');
    item.className = 'sound-item bgm-item';
    
    const audio = new Audio();
    let fadeInterval;
    let isMCMode = false;
    let baseVolume = 0.5; // スライダーの基本音量

    item.innerHTML = `
        <div class="item-header">
            <span>🎵 曲 ${index}</span>
            <label><input type="checkbox" class="repeat-check"> リピート</label>
        </div>
        <input type="file" accept="audio/*" class="file-input">
        <div class="volume-control">
            <span>音量</span>
            <input type="range" min="0" max="1" step="0.01" value="0.5" class="vol-slider">
        </div>
        <div class="controls">
            <button class="play-btn">▶ 再生</button>
            <button class="stop-btn">■ 停止</button>
        </div>
        <div class="controls">
            <button class="fade-in-btn">↗ フェードイン</button>
            <button class="fade-out-btn">↘ フェードアウト</button>
            <button class="mc-btn">🎤 MC(音量下げる)</button>
        </div>
    `;

    // 要素の取得
    const fileInput = item.querySelector('.file-input');
    const playBtn = item.querySelector('.play-btn');
    const stopBtn = item.querySelector('.stop-btn');
    const fadeInBtn = item.querySelector('.fade-in-btn');
    const fadeOutBtn = item.querySelector('.fade-out-btn');
    const mcBtn = item.querySelector('.mc-btn');
    const volSlider = item.querySelector('.vol-slider');
    const repeatCheck = item.querySelector('.repeat-check');

    // ファイル読み込み
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            audio.src = URL.createObjectURL(file);
        }
    });

    // リピート設定
    repeatCheck.addEventListener('change', (e) => {
        audio.loop = e.target.checked;
    });

    // 音量変更
    volSlider.addEventListener('input', (e) => {
        baseVolume = parseFloat(e.target.value);
        if (!isMCMode) {
            audio.volume = baseVolume;
        }
    });

    // 音声状態の表示反映
    audio.addEventListener('play', () => item.classList.add('playing'));
    audio.addEventListener('pause', () => item.classList.remove('playing'));
    audio.addEventListener('ended', () => item.classList.remove('playing'));

    // 再生
    playBtn.addEventListener('click', () => {
        if (!audio.src) return alert("音声ファイルを選択してください。");
        clearInterval(fadeInterval);
        isMCMode = false;
        mcBtn.classList.remove('active-btn');
        audio.volume = baseVolume;
        audio.play().catch(console.error);
    });

    // 停止
    stopBtn.addEventListener('click', () => {
        clearInterval(fadeInterval);
        audio.pause();
        audio.currentTime = 0;
    });

    // フェードイン
    fadeInBtn.addEventListener('click', () => {
        if (!audio.src) return alert("音声ファイルを選択してください。");
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
        }, 200); // 0.2秒ごとに音量アップ
    });

    // フェードアウト
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

    // MCモード（ダッキング）
    mcBtn.addEventListener('click', () => {
        clearInterval(fadeInterval);
        isMCMode = !isMCMode;
        
        if (isMCMode) {
            mcBtn.classList.add('active-btn');
            // 音量をベース音量の20%まで下げる
            const targetVolume = baseVolume * 0.2;
            fadeInterval = setInterval(() => {
                if (audio.volume > targetVolume + 0.05) {
                    audio.volume -= 0.05;
                } else {
                    audio.volume = targetVolume;
                    clearInterval(fadeInterval);
                }
            }, 100);
        } else {
            mcBtn.classList.remove('active-btn');
            // 元の音量に戻す
            fadeInterval = setInterval(() => {
                if (audio.volume < baseVolume - 0.05) {
                    audio.volume += 0.05;
                } else {
                    audio.volume = baseVolume;
                    clearInterval(fadeInterval);
                }
            }, 100);
        }
    });

    container.appendChild(item);
}

// パッドアイテム（ジングル・SE用）の生成
function createPadItem(index, type, container) {
    const item = document.createElement('div');
    item.className = 'sound-item pad-item';
    
    // SEなどは複数同時再生できるように、クリックのたびにAudioオブジェクトを作るアプローチもあるが、
    // シンプルにするため1パッド1Audioとする。連打したい場合は最初から再生し直す。
    let audio = new Audio();
    let baseVolume = 0.5;

    const icon = type === 'jingle' ? '📢' : '💥';
    const title = type === 'jingle' ? `ジングル ${index}` : `SE ${index}`;

    item.innerHTML = `
        <div class="item-header">
            <span>${icon} ${title}</span>
        </div>
        <input type="file" accept="audio/*" class="file-input">
        <div class="volume-control">
            <span>音量</span>
            <input type="range" min="0" max="1" step="0.01" value="0.5" class="vol-slider">
        </div>
        <div class="controls">
            <button class="play-btn">▶ 再生</button>
            <button class="stop-btn">■ 停止</button>
        </div>
    `;

    const fileInput = item.querySelector('.file-input');
    const playBtn = item.querySelector('.play-btn');
    const stopBtn = item.querySelector('.stop-btn');
    const volSlider = item.querySelector('.vol-slider');

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            audio.src = URL.createObjectURL(file);
        }
    });

    volSlider.addEventListener('input', (e) => {
        baseVolume = parseFloat(e.target.value);
        audio.volume = baseVolume;
    });

    audio.addEventListener('play', () => item.classList.add('playing'));
    audio.addEventListener('pause', () => item.classList.remove('playing'));
    audio.addEventListener('ended', () => item.classList.remove('playing'));

    playBtn.addEventListener('click', () => {
        if (!audio.src) return alert("音声ファイルを選択してください。");
        // ポン出しの場合は頭から再生し直す
        audio.currentTime = 0;
        audio.volume = baseVolume;
        audio.play().catch(console.error);
    });

    stopBtn.addEventListener('click', () => {
        audio.pause();
        audio.currentTime = 0;
    });

    container.appendChild(item);
}
