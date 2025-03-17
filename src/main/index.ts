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
import { cleanupMediaServer, startMediaServer } from './mediaServer'
import fs from 'fs'
import { spawn } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'
import { ChildProcessWithoutNullStreams } from 'node:child_process'
import { listAvailableDevices } from './shared'

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
    rtmpUrl: string,
    screenId: string
): Promise<{ success: boolean; message: string }> {
    if (ffmpegProcess2) {
        return { success: false, message: 'Stream is already running' }
    }

    try {
        console.log(`Starting screen stream with parameters:`)
        console.log(`- sourceId: ${sourceId}`)
        console.log(`- screenId: ${screenId}`)
        console.log(`- rtmpUrl: ${rtmpUrl}`)

        const sources = await desktopCapturer.getSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 100, height: 100 }
        })

        console.log('Available screen sources:')
        sources.forEach((source) => {
            console.log(`ID: ${source.id}, Name: ${source.name}`)
        })

        // Try to find the source by ID
        let selectedSource = sources.find((source) => source.id === screenId)

        // If not found, try to find by name containing "Screen" as fallback
        if (!selectedSource) {
            console.log('Screen source not found by ID, trying to find first screen...')
            selectedSource = sources.find((source) => source.name.includes('Screen'))
        }

        if (!selectedSource) {
            return {
                success: false,
                message: `Screen source not found. Available sources: ${sources.map((s) => `${s.id} (${s.name})`).join(', ')}`
            }
        }

        console.log(`Selected screen source: ${selectedSource.name} (${selectedSource.id})`)

        const inputArgs: string[] = []

        // Use a more conservative framerate
        const framerate = '30'

        if (process.platform === 'win32') {
            inputArgs.push('-f', 'gdigrab', '-framerate', framerate, '-i', 'desktop')
        } else if (process.platform === 'darwin') {
            // For macOS, we need to extract just the numeric ID from the full ID
            // Handle different ID formats:
            // - If screenId is already numeric, use it
            // - If it's in format "screen:X:0", extract X
            // - Otherwise default to 1 (main screen)
            let screenNumericId = '1' // Default to main screen

            if (/^\d+$/.test(screenId)) {
                screenNumericId = screenId
            } else {
                const match = screenId.match(/screen:(\d+)/)
                if (match && match[1]) {
                    screenNumericId = match[1]
                }
            }

            console.log(`Using macOS screen numeric ID: ${screenNumericId}`)

            inputArgs.push(
                '-f',
                'avfoundation',
                '-capture_cursor',
                '1', // Capture mouse cursor
                '-capture_mouse_clicks',
                '1', // Show mouse clicks
                '-framerate',
                '60', // Try higher framerate
                '-pix_fmt',
                'uyvy422', // Better pixel format for capture
                '-i',
                `${screenNumericId}:none` // Format is "video:audio" where "none" means no audio
            )
        } else {
            // Linux (x11grab)
            inputArgs.push(
                '-f',
                'x11grab',
                '-framerate',
                framerate,
                '-video_size',
                '1920x1080',
                '-i',
                ':0.0'
            )
        }

        // Add audio if provided
        if (audioDeviceId) {
            if (process.platform === 'darwin') {
                // For macOS, add a separate audio input stream
                // Try to use the specific audio device if possible
                let audioNumericId = '0' // Default to first audio device

                // If we have an audioDeviceId, try to extract a numeric ID if possible
                if (audioDeviceId && audioDeviceId.match(/\d+/)) {
                    audioNumericId = audioDeviceId.match(/\d+/)?.[0] || '0'
                }

                inputArgs.push(
                    '-f',
                    'avfoundation',
                    '-i',
                    `:${audioNumericId}`, // Format is ":audio" for audio-only
                    '-c:a',
                    'aac',
                    '-b:a',
                    '128k'
                )
            } else if (process.platform === 'win32') {
                // For Windows, use the dshow input
                inputArgs.push(
                    '-f',
                    'dshow',
                    '-i',
                    'audio=Microphone', // Generic name, could be customized if needed
                    '-c:a',
                    'aac',
                    '-b:a',
                    '128k'
                )
            } else {
                // Linux
                inputArgs.push('-f', 'alsa', '-i', 'default', '-c:a', 'aac', '-b:a', '128k')
            }
        }

        // Add output settings - these should work well for most cases
        const outputArgs = [
            // Video codec
            '-c:v',
            'libx264',

            // Encoding preset (medium offers better quality than veryfast)
            '-preset',
            'medium',

            // Zero latency tuning for streaming
            '-tune',
            'zerolatency',

            // Much higher video bitrate (6000k instead of 3000k)
            '-b:v',
            '6000k',

            // Max bitrate - allowing occasional peaks
            '-maxrate',
            '8000k',

            // Buffer size - larger buffer helps maintain quality
            '-bufsize',
            '12000k',

            // Higher profile for better quality
            '-profile:v',
            'high',

            // H.264 level (4.2 supports higher bitrates and resolutions)
            '-level:v',
            '4.2',

            // Using CRF rate control for better quality (lower values = higher quality, 18-23 is good)
            '-crf',
            '18',

            // More frequent keyframes (every 2 seconds at 30fps)
            '-g',
            '60',

            // Use no B-frames for lower latency
            '-bf',
            '0',

            // YUV pixel format for compatibility
            '-pix_fmt',
            'yuv420p',

            // If audio is present, ensure good audio quality
            '-c:a',
            'aac',
            '-b:a',
            '192k', // Higher audio bitrate
            '-ar',
            '48000', // Higher audio sample rate

            // Output format
            '-f',
            'flv',
            rtmpUrl
        ]

        // Combine all arguments
        const allArgs = [...inputArgs, ...outputArgs]

        console.log('Starting FFmpeg with command:')
        console.log(`${ffmpegStatic} ${allArgs.join(' ')}`)

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
            ffmpegProcess2 = null
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
        if (error instanceof Error) {
            streamStatus.error = error.toString()
        }
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
            '60',
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
    if (!ffmpegProcess2) {
        return { success: false, message: 'No active screen stream to stop' }
    }

    try {
        ffmpegProcess2.kill('SIGTERM')
        ffmpegProcess2 = null

        // Update stream status
        streamStatus = {
            isStreaming: false,
            streamUrl: '',
            startTime: 0,
            error: ''
        }

        return { success: true, message: 'Screen stream stopped successfully' }
    } catch (error) {
        console.error('Error stopping screen stream:', error)
        return { success: false, message: `Error stopping screen stream: ${error}` }
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

    startMediaServer()

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

app.on('will-quit', () => {
    cleanupMediaServer()
})
