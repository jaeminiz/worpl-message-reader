const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { DEFAULT_INBOX_URL } = require("./message-parser.cjs");
const { WorplMessageAutomation } = require("./automation.cjs");

let mainWindow;
let automation;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 860,
    minHeight: 620,
    title: "WORPL Message Reader",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer.html"));
}

function getAutomation() {
  if (!automation) {
    automation = new WorplMessageAutomation({
      profileDir: path.join(app.getPath("userData"), "chrome-profile")
    });
  }
  return automation;
}

ipcMain.handle("reader:openChrome", async (_event, startUrl) => {
  return getAutomation().openChrome(startUrl || DEFAULT_INBOX_URL);
});

ipcMain.handle("reader:preview", async (_event, options) => {
  return getAutomation().preview(options);
});

ipcMain.handle("reader:run", async (_event, options) => {
  return getAutomation().readVisibleMessages(options);
});

ipcMain.handle("reader:openPreviewMessage", async (_event, index, options) => {
  return getAutomation().openPreviewMessage(index, options);
});

ipcMain.handle("reader:openPath", async (_event, filePath) => {
  if (!filePath) return false;
  await shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle("reader:getVersion", async () => app.getVersion());

app.whenReady().then(createWindow);

app.on("before-quit", async () => {
  if (automation) {
    await automation.close().catch(() => {});
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
