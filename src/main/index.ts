import {
    app,
    BrowserWindow,
    desktopCapturer,
    dialog,
    ipcMain,
    screen,
    session,
    shell,
    systemPreferences
} from 'electron'
import path, { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import fs from 'fs'
import { listAvailableDevices } from './shared'
import {
    getScreenRtmpStatus,
    startScreenRtmpStream,
    stopRtmpScreenStream
} from './shared/rtmp/screenRtmp/screenRtmp'
import {
    getCameraRtmpStatus,
    startRtmpStream,
    stopRtmpStream
} from './shared/rtmp/cameraRtmp/cameraRtmp'

function createWindow(): void {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    const mainWindow = new BrowserWindow({
        width: width,
        height: height,
        show: false,
        autoHideMenuBar: true,
        frame: false,
        fullscreen: !is.dev,
        ...(process.platform === 'linux' ? { icon } : {}),
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            // Enable DevTools in development
            devTools: is.dev,
            sandbox: false,
            // Allow access to media devices
            nodeIntegration: false,
            contextIsolation: true
        }
    })

    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        const allowedPermissions = [
            'media',
            'mediaKeySystem',
            'geolocation',
            'notifications',
            'fullscreen',
            'display-capture'
        ]

        if (allowedPermissions.includes(permission)) {
            callback(true)
        } else {
            callback(false)
        }
    })

    // Add IPC handlers
    ipcMain.handle('get-system-info', () => {
        return {
            platform: process.platform,
            version: app.getVersion(),
            electron: process.versions.electron
        }
    })

    // Handle screen source selection for screen sharing
    ipcMain.handle('get-screen-sources', async () => {
        const sources = await desktopCapturer.getSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 150, height: 150 }
        })
        return sources.map((source) => ({
            id: source.id,
            name: source.name,
            thumbnail: source.thumbnail.toDataURL()
        }))
    })

    ipcMain.handle('start-screen-rtmp-stream', async (_, options) => {
        console.log(options)
        return await startScreenRtmpStream(
            options.sourceId,
            options.audioDeviceId,
            options.rtmpUrl,
            options.screenId
        )
    })

    // Create temporary directory for recordings
    const tempDir = path.join(app.getPath('temp'), 'media-recordings')
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
    }

    ipcMain.handle('start-rtmp-stream', async (_, options) => {
        try {
            const devices = await listAvailableDevices()
            console.log(devices)
            console.log('Available devices according to FFmpeg:')
            console.log(devices)
        } catch (err) {
            console.error('Error listing devices:', err)
        }

        return await startRtmpStream(options.videoDeviceId, options.audioDeviceId, options.rtmpUrl)
    })

    ipcMain.handle('stop-rtmp-stream', () => {
        return stopRtmpStream()
    })

    ipcMain.handle('stop-screen-rtmp-stream', () => {
        return stopRtmpScreenStream()
    })

    ipcMain.handle('get-rtmp-status', async () => {
        const screenRtmp = await getScreenRtmpStatus()
        const cameraRtmp = await getCameraRtmpStatus()
        return {
            isStreaming: screenRtmp.isStreaming && cameraRtmp.isStreaming,
            streamUrl: screenRtmp.streamUrl || cameraRtmp.streamUrl,
            startTime: screenRtmp.startTime || cameraRtmp.startTime,
            error: screenRtmp.error || cameraRtmp.error
        }
    })

    ipcMain.handle('list-ffmpeg-devices', async () => {
        try {
            const devices = await listAvailableDevices()
            return { success: true, devices }
        } catch (error) {
            console.error('Error listing devices:', error)
            return { success: false, error: `${error}` }
        }
    })

    ipcMain.handle('record-media-to-file', async () => {
        try {
            const outputPath = path.join(tempDir, `recording-${Date.now()}.mp4`)

            return {
                success: true,
                filePath: outputPath,
                message: 'Recording started'
            }
        } catch (error) {
            console.error('Error recording media:', error)
            return { success: false, message: String(error) }
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow.show()
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        void shell.openExternal(details.url)
        return { action: 'deny' }
    })

    // Add keyboard shortcut to toggle fullscreen in development
    if (is.dev) {
        mainWindow.webContents.on('before-input-event', (event, input) => {
            if (input.key.toLowerCase() === 'f11') {
                mainWindow.setFullScreen(!mainWindow.isFullScreen())
                event.preventDefault()
            }

            // Allow exit with Escape key in fullscreen mode
            if (input.key === 'Escape' && mainWindow.isFullScreen()) {
                mainWindow.setFullScreen(false)
                event.preventDefault()
            }

            // Allow DevTools with F12
            if (input.key === 'F12') {
                mainWindow.webContents.toggleDevTools()
                event.preventDefault()
            }
        })
    }

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

app.whenReady().then(() => {
    if (process.platform === 'darwin') {
        const screenCaptureStatus = systemPreferences.getMediaAccessStatus('screen')
        if (screenCaptureStatus !== 'granted') {
            dialog
                .showMessageBox({
                    type: 'warning',
                    title: 'Screen Recording Permission Required',
                    message: 'This app needs screen recording permission to stream your screen.',
                    detail: 'Please go to System Preferences > Security & Privacy > Privacy > Screen Recording and enable permission for this app.',
                    buttons: ['OK'],
                    defaultId: 0
                })
                .catch(() => {})
        }
    }

    electronApp.setAppUserModelId('com.electron')

    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
    })

    ipcMain.on('ping', () => console.log('pong'))

    createWindow()

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('will-quit', () => {})
