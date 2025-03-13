import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, shell } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

function createWindow(): void {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: width,
        height: height,
        show: false,
        autoHideMenuBar: true,
        frame: false,
        // Set to true for development, false for production
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

    // Set permissions for media access
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        // Allow all permission requests
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

    ipcMain.handle('check-permission', async (_, permission) => {
        const status = await mainWindow.webContents.session.getPermissionCheckResult(
            permission,
            mainWindow.webContents.getURL()
        )
        return status
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

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.electron')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
    })

    // IPC test
    ipcMain.on('ping', () => console.log('pong'))

    createWindow()

    app.on('activate', function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
