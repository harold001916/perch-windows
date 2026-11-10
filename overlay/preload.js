const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("perch", {
  boot: () => ipcRenderer.invoke("boot"),
  setInteractive: (on) => ipcRenderer.send("interactive", on),
  setSize: (w, h) => ipcRenderer.send("size", w, h),
  setCollapsed: (c) => ipcRenderer.send("collapsed", c),
  drop: (x, y) => ipcRenderer.send("drop", x, y),
  sessionsSnapshot: (list) => ipcRenderer.send("sessions-snapshot", list),
  sessionChanged: (s) => ipcRenderer.send("session-changed", s),
  sessionRemoved: (id) => ipcRenderer.send("session-removed", id),
  onOpenSession: (cb) => ipcRenderer.on("open-session", (_e, id) => cb(id)),
  onLayout: (cb) => ipcRenderer.on("layout", (_e, layout) => cb(layout)),
});
