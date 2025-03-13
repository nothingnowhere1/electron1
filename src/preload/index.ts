import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
    // Add methods for communication between renderer and main process if needed
    getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
    checkPermission: (permission: string) => ipcRenderer.invoke('check-permission', permission),
    getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),

    // Add new RTMP streaming methods
    startRtmpStream: (options: {
        videoDeviceId: string
        audioDeviceId?: string
        rtmpUrl: string
    }) => ipcRenderer.invoke('start-rtmp-stream', options),

    startScreenRtmpStream: (options: {
        sourceId: string
        audioDeviceId?: string
        rtmpUrl: string
    }) => ipcRenderer.invoke('start-screen-rtmp-stream', options),

    stopRtmpStream: () => ipcRenderer.invoke('stop-rtmp-stream'),

    stopScreenRtmpStream: () => ipcRenderer.invoke('stop-screen-rtmp-stream'),

    getRtmpStatus: () => ipcRenderer.invoke('get-rtmp-status'),

    listFfmpegDevices: () => ipcRenderer.invoke('list-ffmpeg-devices')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('electron', electronAPI)
        contextBridge.exposeInMainWorld('api', api)
    } catch (error) {
        console.error(error)
    }
} else {
    // @ts-ignore (define in dts)
    window.electron = electronAPI
    // @ts-ignore (define in dts)
    window.api = api
}
