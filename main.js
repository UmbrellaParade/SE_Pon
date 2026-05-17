const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow () {
  // ブラウザウィンドウを作成します
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    // デスクトップアプリっぽいタイトルバーにする
    autoHideMenuBar: true
  });

  // index.html をロードします
  win.loadFile('index.html');
}

// Electron の初期化が完了した時にウィンドウを作成
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // macOS ではドックのアイコンをクリックした時にウィンドウがなければ再作成する
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 全てのウィンドウが閉じられた時の処理
app.on('window-all-closed', () => {
  // macOS 以外ではアプリケーションを終了する
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
