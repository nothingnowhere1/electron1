import { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'

function parseAvailableFramerates(ffmpegOutput: string): Map<string, number[]> {
    const deviceFramerates = new Map<string, number[]>()
    const lines = ffmpegOutput.split('\n')

    let currentDevice = ''

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()

        if (process.platform === 'darwin') {
            const deviceMatch = line.match(/\[(\d+)\]\s+(.+)/)
            if (deviceMatch) {
                currentDevice = `${deviceMatch[1]}: ${deviceMatch[2]}`
                deviceFramerates.set(currentDevice, [])
                continue
            }

            const modeMatch = line.match(/(\d+x\d+)@\[(\d+\.\d+)\s+\d+\.\d+\]fps/)
            if (modeMatch && currentDevice) {
                const framerate = parseFloat(modeMatch[2])

                const framerates = deviceFramerates.get(currentDevice) || []
                if (!framerates.includes(framerate)) {
                    framerates.push(framerate)
                    deviceFramerates.set(currentDevice, framerates)
                }
            }
        } else if (process.platform === 'win32') {
            if (line.includes('fps=')) {
                const fpsMatch = line.match(/fps=(\d+)/)
                if (fpsMatch && currentDevice) {
                    const framerate = parseInt(fpsMatch[1])
                    const framerates = deviceFramerates.get(currentDevice) || []
                    if (!framerates.includes(framerate)) {
                        framerates.push(framerate)
                        deviceFramerates.set(currentDevice, framerates)
                    }
                }
            }
        }
    }

    return deviceFramerates
}

async function getDeviceFramerates(): Promise<Map<string, number[]>> {
    try {
        const output = await listAvailableDevices()
        return parseAvailableFramerates(output)
    } catch (error) {
        console.error('Error getting device framerates:', error)
        return new Map()
    }
}

// Функция для получения рекомендуемой частоты кадров для конкретного устройства
export async function getBestFramerate(deviceId: string): Promise<number> {
    const deviceFramerates = await getDeviceFramerates()

    let ffmpegDeviceId = deviceId
    if (process.platform === 'darwin' && deviceId.startsWith('screen:')) {
        ffmpegDeviceId = deviceId.match(/screen:(\d+):/)?.[1] || '1'
    }

    for (const [device, framerates] of deviceFramerates.entries()) {
        if (device.startsWith(`${ffmpegDeviceId}:`) || device.includes(ffmpegDeviceId)) {
            if (framerates.length > 0) {
                const sortedRates = [...framerates].sort((a, b) => b - a)
                return sortedRates[0]
            }
        }
    }

    if (process.platform === 'darwin') {
        return 60
    } else if (process.platform === 'win32') {
        return 30
    } else {
        return 30
    }
}

export function listAvailableDevices(): Promise<string> {
    return new Promise((resolve, reject) => {
        let deviceListCommand: string

        if (process.platform === 'darwin') {
            deviceListCommand = '-f avfoundation -list_devices true -i ""'
        } else if (process.platform === 'win32') {
            deviceListCommand = '-f dshow -list_devices true -i dummy'
        } else {
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
            resolve(errorOutput || output)
        })

        ffmpeg.on('error', (err) => {
            reject(`Failed to list devices: ${err}`)
        })
    })
}
