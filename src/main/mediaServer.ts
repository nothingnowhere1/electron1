import { app } from 'electron'
import NodeMediaServer from 'node-media-server'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import os from 'os'

// Path for temporary recordings
const tempDir = path.join(app.getPath('temp'), 'rtmp-stream')

// Ensure temp directory exists
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
}

// Media server config
const nmsConfig = {
    rtmp: {
        port: 1935,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60
    },
    http: {
        port: 8000,
        allow_origin: '*'
    }
}

// Create the RTMP server
const nms = new NodeMediaServer(nmsConfig)

// Variable to store the current streaming process
let streamProcess: ReturnType<typeof spawn> | null = null

/**
 * Start the media server
 */
export function startMediaServer(): void {
    nms.run()
    console.log('RTMP server started on rtmp://localhost:1935')
}

/**
 * Stop any active streaming
 */
export function stopStreaming(): void {
    if (streamProcess) {
        streamProcess.kill()
        streamProcess = null
        console.log('Streaming stopped')
    }
}

/**
 * Start streaming to an RTMP endpoint
 * @param input - Path to input file or stream identifier
 * @param rtmpUrl - RTMP URL to stream to
 * @param options - Additional streaming options
 */
export async function startStreaming(
    input: string,
    rtmpUrl: string,
    options: {
        width?: number
        height?: number
        frameRate?: number
        videoBitrate?: string
        audioBitrate?: string
        audioSampleRate?: number
    } = {}
): Promise<void> {
    // Stop any existing stream
    stopStreaming()

    // Set default options
    const width = options.width || 1280
    const height = options.height || 720
    const frameRate = options.frameRate || 30
    const videoBitrate = options.videoBitrate || '2500k'
    const audioBitrate = options.audioBitrate || '128k'
    const audioSampleRate = options.audioSampleRate || 44100

    // Build FFmpeg command based on input type
    let ffmpegArgs: string[]

    // Get the current platform
    const platform = os.platform()

    // Check if we're capturing the screen
    if (input === 'desktop' || input === 'screen') {
        // Platform-specific screen capture
        if (platform === 'darwin') {
            // macOS - use avfoundation
            ffmpegArgs = [
                '-f',
                'avfoundation',
                '-i',
                '1:0', // 1 is the screen, 0 is system audio
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-tune',
                'zerolatency',
                '-b:v',
                videoBitrate,
                '-maxrate',
                videoBitrate,
                '-bufsize',
                `${parseInt(videoBitrate) * 2}k`,
                '-g',
                '60',
                '-pix_fmt',
                'yuv420p',
                '-s',
                `${width}x${height}`,
                '-r',
                frameRate.toString(),
                '-c:a',
                'aac',
                '-b:a',
                audioBitrate,
                '-ar',
                audioSampleRate.toString(),
                '-f',
                'flv',
                rtmpUrl
            ]
        } else if (platform === 'win32') {
            // Windows - use gdigrab
            ffmpegArgs = [
                '-f',
                'gdigrab',
                '-framerate',
                frameRate.toString(),
                '-i',
                'desktop',
                '-f',
                'dshow',
                '-i',
                'audio=virtual-audio-capturer',
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-tune',
                'zerolatency',
                '-b:v',
                videoBitrate,
                '-maxrate',
                videoBitrate,
                '-bufsize',
                `${parseInt(videoBitrate) * 2}k`,
                '-g',
                '60',
                '-pix_fmt',
                'yuv420p',
                '-s',
                `${width}x${height}`,
                '-c:a',
                'aac',
                '-b:a',
                audioBitrate,
                '-ar',
                audioSampleRate.toString(),
                '-f',
                'flv',
                rtmpUrl
            ]
        } else {
            // Linux - use x11grab
            ffmpegArgs = [
                '-f',
                'x11grab',
                '-framerate',
                frameRate.toString(),
                '-video_size',
                `${width}x${height}`,
                '-i',
                ':0.0',
                '-f',
                'pulse',
                '-i',
                'default',
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-tune',
                'zerolatency',
                '-b:v',
                videoBitrate,
                '-maxrate',
                videoBitrate,
                '-bufsize',
                `${parseInt(videoBitrate) * 2}k`,
                '-g',
                '60',
                '-pix_fmt',
                'yuv420p',
                '-c:a',
                'aac',
                '-b:a',
                audioBitrate,
                '-ar',
                audioSampleRate.toString(),
                '-f',
                'flv',
                rtmpUrl
            ]
        }
    } else if (input.startsWith('camera:')) {
        // Extract device ID
        const deviceId = input.replace('camera:', '')

        // Camera capture - platform-specific
        if (platform === 'darwin') {
            // macOS - use avfoundation
            ffmpegArgs = [
                '-f',
                'avfoundation',
                '-i',
                `${deviceId}:0`, // camera:audio
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-b:v',
                videoBitrate,
                '-s',
                `${width}x${height}`,
                '-r',
                frameRate.toString(),
                '-c:a',
                'aac',
                '-b:a',
                audioBitrate,
                '-ar',
                audioSampleRate.toString(),
                '-f',
                'flv',
                rtmpUrl
            ]
        } else if (platform === 'win32') {
            // Windows - use dshow
            ffmpegArgs = [
                '-f',
                'dshow',
                '-i',
                `video=${deviceId}:audio=default`,
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-b:v',
                videoBitrate,
                '-s',
                `${width}x${height}`,
                '-r',
                frameRate.toString(),
                '-c:a',
                'aac',
                '-b:a',
                audioBitrate,
                '-ar',
                audioSampleRate.toString(),
                '-f',
                'flv',
                rtmpUrl
            ]
        } else {
            // Linux - use v4l2
            ffmpegArgs = [
                '-f',
                'v4l2',
                '-i',
                `/dev/video${deviceId}`,
                '-f',
                'pulse',
                '-i',
                'default',
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-b:v',
                videoBitrate,
                '-s',
                `${width}x${height}`,
                '-r',
                frameRate.toString(),
                '-c:a',
                'aac',
                '-b:a',
                audioBitrate,
                '-ar',
                audioSampleRate.toString(),
                '-f',
                'flv',
                rtmpUrl
            ]
        }
    } else if (input.startsWith('audio:')) {
        // Extract device ID
        const deviceId = input.replace('audio:', '')

        // Audio-only capture
        if (platform === 'darwin') {
            // macOS
            ffmpegArgs = [
                '-f',
                'avfoundation',
                '-i',
                `:${deviceId}`, // :audio (no video)
                '-c:a',
                'aac',
                '-b:a',
                audioBitrate,
                '-ar',
                audioSampleRate.toString(),
                '-f',
                'flv',
                rtmpUrl
            ]
        } else if (platform === 'win32') {
            // Windows
            ffmpegArgs = [
                '-f',
                'dshow',
                '-i',
                `audio=${deviceId}`,
                '-c:a',
                'aac',
                '-b:a',
                audioBitrate,
                '-ar',
                audioSampleRate.toString(),
                '-f',
                'flv',
                rtmpUrl
            ]
        } else {
            // Linux
            ffmpegArgs = [
                '-f',
                'pulse',
                '-i',
                deviceId || 'default',
                '-c:a',
                'aac',
                '-b:a',
                audioBitrate,
                '-ar',
                audioSampleRate.toString(),
                '-f',
                'flv',
                rtmpUrl
            ]
        }
    } else {
        // Assume input is a file path
        ffmpegArgs = [
            '-i',
            input,
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-b:v',
            videoBitrate,
            '-s',
            `${width}x${height}`,
            '-r',
            frameRate.toString(),
            '-c:a',
            'aac',
            '-b:a',
            audioBitrate,
            '-ar',
            audioSampleRate.toString(),
            '-f',
            'flv',
            rtmpUrl
        ]
    }

    console.log('Starting FFmpeg with command:', ffmpegPath, ffmpegArgs.join(' '))

    // Start the FFmpeg process
    streamProcess = spawn(ffmpegPath as string, ffmpegArgs, {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
    })

    // Log output
    streamProcess.stdout?.on('data', (data) => {
        console.log(`FFmpeg stdout: ${data}`)
    })

    streamProcess.stderr?.on('data', (data) => {
        console.log(`FFmpeg stderr: ${data}`)
    })

    // Handle process exit
    streamProcess.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`)
        streamProcess = null
    })
}

/**
 * Clean up function to be called when app is closing
 */
export function cleanupMediaServer(): void {
    stopStreaming()
    nms.stop()
    console.log('RTMP server stopped')
}
