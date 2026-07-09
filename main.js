const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen } = require('electron');
const fs = require('fs/promises');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#12151b',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: !app.isPackaged,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
    }
  });

  win.loadFile('index.html');
}

ipcMain.handle('asset:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Unity Volume Profile (.asset) を選択',
    properties: ['openFile'],
    filters: [{ name: 'Unity Asset', extensions: ['asset'] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = result.filePaths[0];
  const content = await fs.readFile(selectedPath, 'utf8');
  return { path: selectedPath, content };
});

ipcMain.handle('capture:screens', async () => {
  try {
    const displays = screen.getAllDisplays();
    const maxWidth = Math.max(1, ...displays.map((display) => Math.ceil(display.size.width * display.scaleFactor)));
    const maxHeight = Math.max(1, ...displays.map((display) => Math.ceil(display.size.height * display.scaleFactor)));
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxWidth, height: maxHeight }
    });

    return sources.map((source) => {
      const size = source.thumbnail.getSize();
      return {
        id: source.id,
        name: source.name,
        dataURL: source.thumbnail.toDataURL(),
        width: size.width,
        height: size.height
      };
    });
  } catch (error) {
    return { error: error && error.message ? error.message : String(error) };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
