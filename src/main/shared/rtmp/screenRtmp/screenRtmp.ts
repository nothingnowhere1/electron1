import { desktopCapturer } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import { spawn } from 'child_process'
import { ChildProcessWithoutNullStreams } from 'node:child_process'

let ffmpegProcess2: ChildProcessWithoutNullStreams | null

let streamStatus = {
    isStreaming: false,
    streamUrl: '',
    startTime: 0,
    error: ''
}
export async function startScreenRtmpStream(
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

        let selectedSource = sources.find((source) => source.id === screenId)

        console.log(sources)
        if (!selectedSource) {
            console.log('Screen source not found by ID, trying to find first screen...')
            selectedSource = sources.find((source) => source.name.includes('screen'))
        }

        if (!selectedSource) {
            return {
                success: false,
                message: `Screen source not found. Available sources: ${sources.map((s) => `${s.id} (${s.name})`).join(', ')}`
            }
        }

        console.log(`Selected screen source: ${selectedSource.name} (${selectedSource.id})`)

        const inputArgs: string[] = []

        const framerate = '30'

        if (process.platform === 'win32') {
            inputArgs.push('-f', 'gdigrab', '-framerate', framerate, '-i', 'desktop')
        } else if (process.platform === 'darwin') {
            let screenNumericId = '1'

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
                '1',
                '-capture_mouse_clicks',
                '1',
                '-framerate',
                '60',
                '-pix_fmt',
                'uyvy422',
                '-i',
                `${screenNumericId}:none`
            )
        } else {
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

        if (audioDeviceId) {
            if (process.platform === 'darwin') {
                let audioNumericId = '0'

                if (audioDeviceId && audioDeviceId.match(/\d+/)) {
                    audioNumericId = audioDeviceId.match(/\d+/)?.[0] || '0'
                }

                inputArgs.push(
                    '-f',
                    'avfoundation',
                    '-i',
                    `:${audioNumericId}`,
                    '-c:a',
                    'aac',
                    '-b:a',
                    '128k'
                )
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

        const outputArgs = [
            '-c:v',
            'libx264',
            '-preset',
            'medium',
            '-tune',
            'zerolatency',
            '-b:v',
            '6000k',
            '-maxrate',
            '8000k',
            '-bufsize',
            '12000k',
            '-profile:v',
            'high',
            '-level:v',
            '4.2',
            '-crf',
            '18',
            '-g',
            '60',
            '-bf',
            '0',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-ar',
            '48000',
            '-f',
            'flv',
            rtmpUrl
        ]
        const allArgs = [...inputArgs, ...outputArgs]

        console.log('Starting FFmpeg with command:')
        console.log(`${ffmpegStatic} ${allArgs.join(' ')}`)
        ffmpegProcess2 = spawn(ffmpegStatic ?? '', allArgs, {
            detached: false,
            stdio: 'pipe'
        })
        ffmpegProcess2.stdout.on('data', (data: Buffer) => {
            console.log(`FFmpeg stdout: ${data.toString()}`)
        })

        ffmpegProcess2.stderr.on('data', (data: Buffer) => {
            console.log(`FFmpeg stderr: ${data.toString()}`)
        })
        ffmpegProcess2.on('close', (code: number) => {
            console.log(`FFmpeg process exited with code ${code}`)
            ffmpegProcess2 = null
            streamStatus.isStreaming = false
            streamStatus.error = code !== 0 ? `FFmpeg exited with code ${code}` : ''
        })
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

export function stopRtmpScreenStream(): { success: boolean; message: string } {
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

export async function getScreenRtmpStatus() {
    return streamStatus
}
