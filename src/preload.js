const { contextBridge, ipcRenderer } = require('electron');

const channels = ['media', 'art', 'lyrics', 'weather', 'peek', 'theme', 'open-settings', 'claude:ask', 'claude:resolved', 'claude:done', 'claude:working', 'mouse-out', 'update:ready', 'care:tab', 'notif', 'notif-status'];

contextBridge.exposeInMainWorld('notch', {
  on: (ch, cb) => { if (channels.includes(ch)) ipcRenderer.on(ch, (_e, d) => cb(d)); },
  mouse: (interactive) => ipcRenderer.send('mouse', interactive),
  media: (cmd) => ipcRenderer.send('media', cmd),
  decide: (id, behavior) => ipcRenderer.send('claude:decide', { id, behavior }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.send('settings:set', patch),
  searchCity: (name) => ipcRenderer.invoke('city:search', name),
  installHooks: () => ipcRenderer.invoke('hooks:install'),
  removeHooks: () => ipcRenderer.invoke('hooks:remove'),
  setLogin: (v) => ipcRenderer.send('login:set', v),
  openCare: (tab) => ipcRenderer.send('care:open', tab),
  care: (action, arg) => ipcRenderer.invoke('care:run', action, arg || {}),
  stats: () => ipcRenderer.invoke('sys:stats'),
  careTheme: () => ipcRenderer.invoke('care:theme'),
  openUrl: (u) => ipcRenderer.send('shell:open', u),
  showFile: (p) => ipcRenderer.send('shell:show', p),
  trash: (p) => ipcRenderer.invoke('shell:trash', p),
  installUpdate: () => ipcRenderer.send('update:install'),
  version: () => ipcRenderer.invoke('app:version'),
  notifOpen: (n) => ipcRenderer.send('notif:open', n),
  notifMute: (appId) => ipcRenderer.send('notif:mute', appId),
});
