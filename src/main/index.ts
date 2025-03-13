import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, shell } from 'electron'
import path, { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { cleanupMediaServer, startMediaServer } from './mediaServer'
import fs from 'fs'
import { spawn } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'
import { ChildProcessWithoutNullStreams } from 'node:child_process'

let ffmpegProcess: ChildProcessWithoutNullStreams | null
let streamStatus = {
    isStreaming: false,
    streamUrl: '',
    startTime: 0,
    error: ''
}
let ffmpegProcess2: ChildProcessWithoutNullStreams | null

async function startScreenRtmpStream(
    sourceId: string,
    audioDeviceId: string | undefined,
    rtmpUrl: string
): Promise<{ success: boolean; message: string }> {
    if (ffmpegProcess2) {
        return { success: false, message: 'Stream is already running' }
    }
    try {
        console.log(`Using FFmpeg from: ${ffmpegStatic}`)
        console.log(`Screen source ID: ${sourceId}`)

        // For screen capture, we need to use a different approach
        // We'll use Electron's desktopCapturer to get thumbnails and metadata for the screen
        const sources = await desktopCapturer.getSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 100, height: 100 }
        })

        const selectedSource = sources.find((source) => source.id === sourceId)
        console.log('All sources', sources)
        if (!selectedSource) {
            return { success: false, message: `Screen source with ID ${sourceId} not found` }
        }

        console.log(`Selected screen source: ${selectedSource.name}`)

        // Determine OS-specific settings
        const inputArgs = []

        if (process.platform === 'win32') {
            // On Windows, use gdigrab or dshow
            inputArgs.push('-f', 'gdigrab', '-framerate', '30', '-i', 'desktop')
        } else if (process.platform === 'darwin') {
            // On macOS, use avfoundation
            // The "1" is typically the entire screen on macOS, but may need adjustment
            // Use "-video_size" to specify resolution if needed
            inputArgs.push(
                '-f',
                'avfoundation',
                '-framerate',
                '30',
                // Ensure proper pixel format
                '-pix_fmt',
                'uyvy422', // This is supported according to your error logs
                '-i',
                '1:none' // "1" is typically the entire screen on macOS
            )
        } else {
            // On Linux, use x11grab
            inputArgs.push(
                '-f',
                'x11grab',
                '-framerate',
                '30',
                '-video_size',
                '1920x1080',
                '-i',
                ':0.0'
            )
        }

        // Add audio if provided
        if (audioDeviceId) {
            if (process.platform === 'darwin') {
                inputArgs.push('-f', 'avfoundation', '-i', ':0', '-c:a', 'aac', '-b:a', '128k')
            } else if (process.platform === 'win32') {
                inputArgs.push(
                    '-f',
                    'dshow',
                    '-i',
                    'audio=Microphone',
                    '-c:a',
                    'aac',
                    '-b:a',
                    '128k'
                )
            } else {
                inputArgs.push('-f', 'alsa', '-i', 'default', '-c:a', 'aac', '-b:a', '128k')
            }
        }

        // Add output settings
        const outputArgs = [
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-tune',
            'zerolatency', // Better for streaming
            '-b:v',
            '2500k',
            '-bufsize',
            '5000k',
            '-pix_fmt',
            'yuv420p', // Ensure compatibility
            '-f',
            'flv',
            rtmpUrl
        ]

        // Combine all arguments
        const allArgs = [...inputArgs, ...outputArgs]

        // Start FFmpeg process
        ffmpegProcess2 = spawn(ffmpegStatic ?? '', allArgs, {
            detached: false,
            stdio: 'pipe'
        })

        // Handle FFmpeg output
        ffmpegProcess2.stdout.on('data', (data: Buffer) => {
            console.log(`FFmpeg stdout: ${data.toString()}`)
        })

        ffmpegProcess2.stderr.on('data', (data: Buffer) => {
            console.log(`FFmpeg stderr: ${data.toString()}`)
        })

        // Handle FFmpeg exit
        ffmpegProcess2.on('close', (code: number) => {
            console.log(`FFmpeg process exited with code ${code}`)
            ffmpegProcess = null
            streamStatus.isStreaming = false
            streamStatus.error = code !== 0 ? `FFmpeg exited with code ${code}` : ''
        })

        // Update stream status
        streamStatus = {
            isStreaming: true,
            streamUrl: rtmpUrl,
            startTime: Date.now(),
            error: ''
        }

        return { success: true, message: 'Screen stream started successfully' }
    } catch (error) {
        console.error('Error starting screen stream:', error)
        streamStatus.error = error.toString()
        return { success: false, message: `Error starting screen stream: ${error}` }
    }
}

async function startRtmpStream(
    videoDeviceId: string,
    audioDeviceId: string | undefined,
    rtmpUrl: string
): Promise<{ success: boolean; message: string }> {
    if (ffmpegProcess) {
        return { success: false, message: 'Stream is already running' }
    }

    try {
        // Determine which input format to use based on OS platform
        let inputFormat = 'dshow' // Default for Windows
        if (process.platform === 'darwin') {
            inputFormat = 'avfoundation'
        } else if (process.platform === 'linux') {
            inputFormat = 'v4l2'
        }

        console.log(`Using input format: ${inputFormat} for platform: ${process.platform}`)
        console.log(`Video device ID: ${videoDeviceId}`)

        // For browser-obtained device IDs, we need to use more general device names
        // Device IDs from browsers don't directly map to FFmpeg device IDs
        const videoInput = process.platform === 'darwin' ? '0' : 'video=Webcam' // Generic name for first camera

        // ffmpeg command to start streaming
        const args = [
            '-f',
            inputFormat,
            '-framerate',
            '30',
            '-video_size',
            '1280x720',
            '-i',
            videoInput // Using generic device name instead of browser device ID
        ]

        // Add audio if provided
        if (audioDeviceId) {
            if (process.platform === 'darwin') {
                // On macOS, audio devices are specified with a colon prefix in avfoundation
                args.push('-f', inputFormat, '-i', `:0`, '-c:a', 'aac', '-b:a', '128k')
            } else if (process.platform === 'win32') {
                // On Windows, audio devices need separate input
                args.push(
                    '-f',
                    inputFormat,
                    '-i',
                    'audio=Microphone',
                    '-c:a',
                    'aac',
                    '-b:a',
                    '128k'
                )
            } else {
                // Linux
                args.push('-f', 'alsa', '-i', 'default', '-c:a', 'aac', '-b:a', '128k')
            }
        }

        // Add output settings
        args.push(
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-b:v',
            '2500k',
            '-bufsize',
            '5000k',
            '-f',
            'flv',
            rtmpUrl
        )

        // Use the bundled FFmpeg binary instead of relying on system installation
        console.log(`Using FFmpeg from: ${ffmpegStatic}`)
        ffmpegProcess = spawn(ffmpegStatic ?? '', args, {
            detached: false,
            stdio: 'pipe'
        })

        // Handle FFmpeg output
        ffmpegProcess.stdout.on('data', (data: Buffer) => {
            console.log(`FFmpeg stdout: ${data.toString()}`)
        })

        ffmpegProcess.stderr.on('data', (data: Buffer) => {
            console.log(`FFmpeg stderr: ${data.toString()}`)
        })

        // Handle FFmpeg exit
        ffmpegProcess.on('close', (code: number) => {
            console.log(`FFmpeg process exited with code ${code}`)
            ffmpegProcess = null
            streamStatus.isStreaming = false
            streamStatus.error = code !== 0 ? `FFmpeg exited with code ${code}` : ''
        })

        // Update stream status
        streamStatus = {
            isStreaming: true,
            streamUrl: rtmpUrl,
            startTime: Date.now(),
            error: ''
        }

        return { success: true, message: 'Stream started successfully' }
    } catch (error) {
        console.error('Error starting stream:', error)
        if (error instanceof Error) {
            streamStatus.error = error.message
        } else {
            streamStatus.error = `${error}`
        }
        return { success: false, message: `Error starting stream: ${error}` }
    }
}

// Function to stop RTMP streaming
function stopRtmpStream(): { success: boolean; message: string } {
    if (!ffmpegProcess) {
        return { success: false, message: 'No active stream to stop' }
    }

    try {
        ffmpegProcess.kill('SIGTERM')
        ffmpegProcess = null

        // Update stream status
        streamStatus = {
            isStreaming: false,
            streamUrl: '',
            startTime: 0,
            error: ''
        }

        return { success: true, message: 'Stream stopped successfully' }
    } catch (error) {
        console.error('Error stopping stream:', error)
        return { success: false, message: `Error stopping stream: ${error}` }
    }
}

function stopRtmpScreenStream(): { success: boolean; message: string } {
    if (!ffmpegProcess) {
        return { success: false, message: 'No active stream to stop' }
    }

    try {
        ffmpegProcess.kill('SIGTERM')
        ffmpegProcess = null

        // Update stream status
        streamStatus = {
            isStreaming: false,
            streamUrl: '',
            startTime: 0,
            error: ''
        }

        return { success: true, message: 'Stream stopped successfully' }
    } catch (error) {
        console.error('Error stopping stream:', error)
        return { success: false, message: `Error stopping stream: ${error}` }
    }
}

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
        return await startScreenRtmpStream(options.sourceId, options.audioDeviceId, options.rtmpUrl)
    })

    // Create temporary directory for recordings
    const tempDir = path.join(app.getPath('temp'), 'media-recordings')
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
    }

    function listAvailableDevices(): Promise<string> {
        return new Promise((resolve, reject) => {
            let deviceListCommand: string

            if (process.platform === 'darwin') {
                // macOS - list avfoundation devices
                deviceListCommand = '-f avfoundation -list_devices true -i ""'
            } else if (process.platform === 'win32') {
                // Windows - list dshow devices
                deviceListCommand = '-f dshow -list_devices true -i dummy'
            } else {
                // Linux - list v4l2 devices
                deviceListCommand = '-f v4l2 -list_devices true -i /dev/video0'
            }

            const args = deviceListCommand.split(' ').filter((arg) => arg.length > 0)
            const ffmpeg: ChildProcessWithoutNullStreams = spawn(ffmpegStatic ?? '', args, {
                stdio: 'pipe'
            })

            let output = ''
            let errorOutput = ''

            ffmpeg.stdout.on('data', (data) => {
                output += data.toString()
            })

            ffmpeg.stderr.on('data', (data) => {
                errorOutput += data.toString()
            })

            ffmpeg.on('close', (code) => {
                console.log(`FFmpeg device listing exited with code ${code}`)
                // For FFmpeg, the device list is usually in stderr even though it's not an error
                resolve(errorOutput || output)
            })

            ffmpeg.on('error', (err) => {
                reject(`Failed to list devices: ${err}`)
            })
        })
    }

    // Add IPC handlers for RTMP streaming
    ipcMain.handle('start-rtmp-stream', async (_, options) => {
        // First list available devices to help with debugging
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

    ipcMain.handle('get-rtmp-status', () => {
        return streamStatus
    })

    // Add handler to list available devices
    ipcMain.handle('list-ffmpeg-devices', async () => {
        try {
            const devices = await listAvailableDevices()
            return { success: true, devices }
        } catch (error) {
            console.error('Error listing devices:', error)
            return { success: false, error: `${error}` }
        }
    })

    // Handler for recording media stream
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

    // Start the RTMP media server
    startMediaServer()

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

// Clean up resources before app quits
app.on('will-quit', () => {
    cleanupMediaServer()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
