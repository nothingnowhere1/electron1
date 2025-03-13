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
        }
    }
}
