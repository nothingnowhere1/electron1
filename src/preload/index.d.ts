import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
    interface Window {
        electron: ElectronAPI
        api: {
            getSystemInfo: () => Promise<{
                platform: string
                version: string
                electron: string
            }>
            checkPermission: (permission: string) => Promise<string>
            getScreenSources: () => Promise<
                Array<{
                    id: string
                    name: string
                    thumbnail: string
                }>
            >
            startScreenRtmpStream: (options: {
                sourceId: string
                audioDeviceId?: string
                rtmpUrl: string
            }) => Promise<{ success: boolean; message: string }>
            // Add new RTMP streaming methods
            startRtmpStream: (options: {
                videoDeviceId: string
                audioDeviceId?: string
                rtmpUrl: string
            }) => Promise<{ success: boolean; message: string }>
            stopRtmpStream: () => Promise<{ success: boolean; message: string }>
            stopScreenRtmpStream: () => Promise<{ success: boolean; message: string }>
            getRtmpStatus: () => Promise<{
                isStreaming: boolean
                streamUrl?: string
                startTime: number
                error?: string
            }>
            listFfmpegDevices: () => Promise<{
                success: boolean
                devices?: string
                error?: string
            }>
        }
    }
}
