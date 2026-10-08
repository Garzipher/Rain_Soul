"use strict";

// src/preload/index.ts
var import_electron = require("electron");
var invoke = async (command, payload) => {
  const reply = await import_electron.ipcRenderer.invoke("rainsoul:command", command, payload);
  if (!reply.ok) throw new Error(reply.message ?? "\u672C\u673A\u64CD\u4F5C\u5931\u8D25");
  return reply.data;
};
var api = {
  listWorks: () => invoke("listWorks", {}),
  createWork: (title) => invoke("createWork", { title }),
  openWork: (id) => invoke("openWork", { id }),
  addChapter: (workId, title, expectedRevision, operationId, volumeId = null) => invoke("addChapter", { workId, title, expectedRevision, operationId, volumeId }),
  saveChapter: (workId, chapterId, title, document, expectedRevision, operationId) => invoke("saveChapter", { workId, chapterId, title, document, expectedRevision, operationId }),
  getRuntimeInfo: () => invoke("runtimeInfo", {}),
  manageStructure: (request) => invoke("manageStructure", request),
  listDeletedWorks: () => invoke("listDeletedWorks", {}),
  onCloseRequested: (handler) => {
    const listener = (_event, token) => {
      void handler().then(() => import_electron.ipcRenderer.send("rainsoul:close-confirm", token)).catch(() => {
      });
    };
    import_electron.ipcRenderer.on("rainsoul:close-request", listener);
    return () => {
      import_electron.ipcRenderer.removeListener("rainsoul:close-request", listener);
    };
  }
};
import_electron.contextBridge.exposeInMainWorld("rainSoul", api);
