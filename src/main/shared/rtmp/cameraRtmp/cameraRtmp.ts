import ffmpegStatic from 'ffmpeg-static'
import { spawn } from 'child_process'
import { ChildProcessWithoutNullStreams } from 'node:child_process'

let ffmpegProcess: ChildProcessWithoutNullStreams | null
let streamStatus = {
    isStreaming: false,
    streamUrl: '',
    startTime: 0,
    error: ''
}
export async function startRtmpStream(
    videoDeviceId: string,
    audioDeviceId: string | undefined,
    rtmpUrl: string
): Promise<{ success: boolean; message: string }> {
    if (ffmpegProcess) {
        return { success: false, message: 'Stream is already running' }
    }

    try {
        let inputFormat = 'dshow'
        if (process.platform === 'darwin') {
            inputFormat = 'avfoundation'
        } else if (process.platform === 'linux') {
            inputFormat = 'v4l2'
        }

        console.log(`Using input format: ${inputFormat} for platform: ${process.platform}`)
        console.log(`Video device ID: ${videoDeviceId}`)

        const videoInput = process.platform === 'darwin' ? '0' : 'video=Webcam' // Generic name for first camera

        const args = [
            '-f',
            inputFormat,
            '-framerate',
            '30',
            '-video_size',
            '1280x720',
            '-i',
            videoInput
        ]

        if (audioDeviceId) {
            if (process.platform === 'darwin') {
                args.push('-f', inputFormat, '-i', `:0`, '-c:a', 'aac', '-b:a', '128k')
            } else if (process.platform === 'win32') {
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
                args.push('-f', 'alsa', '-i', 'default', '-c:a', 'aac', '-b:a', '128k')
            }
        }

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

        console.log(`Using FFmpeg from: ${ffmpegStatic}`)
        ffmpegProcess = spawn(ffmpegStatic ?? '', args, {
            detached: false,
            stdio: 'pipe'
        })

        ffmpegProcess.stdout.on('data', (data: Buffer) => {
            console.log(`FFmpeg stdout: ${data.toString()}`)
        })

        ffmpegProcess.stderr.on('data', (data: Buffer) => {
            console.log(`FFmpeg stderr: ${data.toString()}`)
        })

        ffmpegProcess.on('close', (code: number) => {
            console.log(`FFmpeg process exited with code ${code}`)
            ffmpegProcess = null
            streamStatus.isStreaming = false
            streamStatus.error = code !== 0 ? `FFmpeg exited with code ${code}` : ''
        })

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

export function stopRtmpStream(): { success: boolean; message: string } {
    if (!ffmpegProcess) {
        return { success: false, message: 'No active screen stream to stop' }
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

        return { success: true, message: 'Screen stream stopped successfully' }
    } catch (error) {
        console.error('Error stopping screen stream:', error)
        return { success: false, message: `Error stopping screen stream: ${error}` }
    }
}

export async function getCameraRtmpStatus() {
    return streamStatus
}
