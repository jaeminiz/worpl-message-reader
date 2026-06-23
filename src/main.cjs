const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const { DEFAULT_INBOX_URL } = require("./message-parser.cjs");
const { WorplMessageAutomation } = require("./automation.cjs");
const packageInfo = require("../package.json");

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
  createApplicationMenu();
}

function createApplicationMenu() {
  const template = [
    {
      label: "도움말",
      submenu: [
        {
          label: "사용 설명",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "사용 설명",
              message: "WORPL 쪽지 오토클릭 사용 설명",
              detail: [
                "1. Chrome 열기를 누르고 WORPL에 로그인합니다.",
                "2. 키워드 신규만 또는 신규 전체를 선택한 뒤 미리보기를 실행합니다.",
                "3. 키워드 신규만은 첫 페이지에 결과가 없어도 다음 페이지를 계속 검색합니다.",
                "4. 읽음 처리 실행 중 일시정지를 누르면 현재까지 실제로 읽은 쪽지만 엑셀에 저장하고 멈춥니다.",
                "5. 대량 실행 중에는 20건 단위로 중간 저장합니다."
              ].join("\n")
            });
          }
        },
        {
          label: "프로그램 정보",
          click: () => {
            const author = normalizeAuthor(packageInfo.author);
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "프로그램 정보",
              message: "WORPL 쪽지 오토클릭",
              detail: [`버전: ${app.getVersion()}`, `제작자: ${author.name}`, `메일: ${author.email}`].join("\n")
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function normalizeAuthor(author) {
  if (typeof author === "string") {
    const match = author.match(/^(.*?)\s*<([^>]+)>/);
    return {
      name: (match ? match[1] : author).trim(),
      email: match ? match[2].trim() : ""
    };
  }

  return {
    name: author?.name || "",
    email: author?.email || ""
  };
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

ipcMain.handle("reader:pause", async () => {
  return getAutomation().requestPause();
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

ipcMain.handle("reader:getAppInfo", async () => ({
  version: app.getVersion(),
  author: normalizeAuthor(packageInfo.author)
}));

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
