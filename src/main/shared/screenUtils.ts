import electron from 'electron'

export const getAvailableScreens = async () => {
    const sources = await electron.desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 150, height: 150 }
    })
    return sources.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL()
    }))
}
