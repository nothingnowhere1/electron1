import { ChangeEvent, useEffect, useRef, useState } from 'react'

function App() {
    // State hooks for managing different media streams
    const [activeDevice, setActiveDevice] = useState<string>('camera')
    const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
    const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
    const [currentVideoDevice, setCurrentVideoDevice] = useState<string>('')
    const [currentAudioDevice, setCurrentAudioDevice] = useState<string>('')
    const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false)
    const [isMicrophoneActive, setIsMicrophoneActive] = useState<boolean>(false)

    // RTMP streaming state
    const [isRtmpStreaming, setIsRtmpStreaming] = useState<boolean>(false)
    const [rtmpUrl, setRtmpUrl] = useState<string>('rtmp://proctor.sofiasoft.kz/live')
    const [streamDuration, setStreamDuration] = useState<number>(0)
    const [streamError, setStreamError] = useState<string>('')

    const [selectedSource, setSelectedSource] = useState<string>('')

    // Refs for DOM elements
    const videoRef = useRef<HTMLVideoElement>(null)
    const audioContext = useRef<AudioContext | null>(null)
    const audioAnalyser = useRef<AnalyserNode | null>(null)
    const audioDataArray = useRef<Uint8Array | null>(null)
    const animationFrameId = useRef<number | null>(null)

    // Fetch available media devices
    useEffect(() => {
        const getDevices = async () => {
            try {
                // Request permission to access devices
                await navigator.mediaDevices.getUserMedia({ video: true, audio: true })

                const devices = await navigator.mediaDevices.enumerateDevices()

                const videoInputs = devices.filter((device) => device.kind === 'videoinput')
                const audioInputs = devices.filter((device) => device.kind === 'audioinput')

                setVideoDevices(videoInputs)
                setAudioDevices(audioInputs)

                // Set default devices if available
                if (videoInputs.length > 0) {
                    setCurrentVideoDevice(videoInputs[0].deviceId)
                }

                if (audioInputs.length > 0) {
                    setCurrentAudioDevice(audioInputs[0].deviceId)
                }
            } catch (error) {
                console.error('Error enumerating devices: ', error)
            }
        }
        void fetchScreenSources()
        void getDevices()
        // Set up device change listener
        navigator.mediaDevices.addEventListener('devicechange', getDevices)

        return () => {
            navigator.mediaDevices.removeEventListener('devicechange', getDevices)

            // Clean up audio analyzer
            if (animationFrameId.current) {
                cancelAnimationFrame(animationFrameId.current)
            }

            if (audioContext.current) {
                void audioContext.current.close()
            }
        }
    }, [])

    // Add RTMP status check interval
    useEffect(() => {
        let statusInterval: number | null = null

        if (isRtmpStreaming) {
            statusInterval = window.setInterval(async () => {
                const status = await window.api.getRtmpStatus()

                if (status.isStreaming) {
                    const duration = Math.floor((Date.now() - status.startTime) / 1000)
                    setStreamDuration(duration)
                } else {
                    setIsRtmpStreaming(false)
                    setStreamDuration(0)

                    if (status.error) {
                        setStreamError(status.error)
                    }
                }
            }, 1000)
        }

        return () => {
            if (statusInterval) {
                clearInterval(statusInterval)
            }
        }
    }, [isRtmpStreaming])

    const fetchScreenSources = async () => {
        try {
            // Call the Electron API function via preload
            const sources = await window.api.getScreenSources()
            sources.forEach((source) => {
                console.log(source)
            })
            if (sources.length > 0) {
                setSelectedSource(sources[0].id)
            }
        } catch (error) {
            console.error('Failed to get screen sources:', error)
        }
    }

    // Function to activate camera
    const startCamera = async () => {
        try {
            // Stop any existing streams
            stopAllStreams()

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: currentVideoDevice ? { exact: currentVideoDevice } : undefined },
                audio: false
            })

            if (videoRef.current) {
                videoRef.current.srcObject = stream
            }

            setActiveDevice('camera')
            setIsScreenSharing(false)
            setIsMicrophoneActive(false)
        } catch (error) {
            console.error('Error accessing camera: ', error)
        }
    }

    // Function to activate microphone
    const startMicrophone = async () => {
        try {
            // Stop any existing microphone stream
            if (isMicrophoneActive) {
                stopMicrophone()
                return
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: currentAudioDevice ? { exact: currentAudioDevice } : undefined }
            })

            // Set up audio analysis
            audioContext.current = new AudioContext()
            const source = audioContext.current.createMediaStreamSource(stream)
            audioAnalyser.current = audioContext.current.createAnalyser()
            audioAnalyser.current.fftSize = 256

            source.connect(audioAnalyser.current)

            const bufferLength = audioAnalyser.current.frequencyBinCount
            audioDataArray.current = new Uint8Array(bufferLength)

            // Start monitoring audio levels
            const updateAudioLevel = () => {
                if (audioAnalyser.current && audioDataArray.current) {
                    audioAnalyser.current.getByteFrequencyData(audioDataArray.current)

                    // Calculate average level
                    // const average =
                    //     audioDataArray.current.reduce((sum, value) => sum + value, 0) /
                    //     audioDataArray.current.length

                    animationFrameId.current = requestAnimationFrame(updateAudioLevel)
                }
            }

            updateAudioLevel()
            setIsMicrophoneActive(true)

            // If we have a video already playing, keep it going
            if (!videoRef.current?.srcObject && !isScreenSharing) {
                setActiveDevice('microphone')
            }
        } catch (error) {
            console.error('Error accessing microphone: ', error)
        }
    }

    // Function to stop microphone
    const stopMicrophone = () => {
        if (animationFrameId.current) {
            cancelAnimationFrame(animationFrameId.current)
            animationFrameId.current = null
        }

        if (audioContext.current) {
            void audioContext.current.close()
            audioContext.current = null
        }

        setIsMicrophoneActive(false)
    }

    const startScreenRtmpStreaming = async () => {
        try {
            const rtmpUrl2 = rtmpUrl + 2
            console.log('RTMP streaming: ', rtmpUrl2)
            console.log(selectedSource)

            const result = await window.api.startScreenRtmpStream({
                sourceId: selectedSource,
                audioDeviceId: currentAudioDevice,
                rtmpUrl: rtmpUrl2,
                screenId: selectedSource
            })

            if (result.success) {
                console.log(rtmpUrl2)
                setIsRtmpStreaming(true)
                setStreamError('')
            } else {
                setStreamError(result.message)
            }
        } catch (error) {
            console.error('Error starting screen RTMP stream:', error)
            if (error instanceof Error) {
                setStreamError(`Error: ${error.message}`)
            }
        }
    }

    // Function to stop all streams
    const stopAllStreams = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream
            stream.getTracks().forEach((track) => track.stop())
            videoRef.current.srcObject = null
        }

        stopMicrophone()
    }

    // Function to start RTMP streaming
    const startRtmpStreaming = async () => {
        if (!currentVideoDevice) {
            setStreamError('Please select a camera first')
            return
        }

        try {
            const rtmpUrl1 = rtmpUrl + 1
            console.log(currentVideoDevice)
            const result = await window.api.startRtmpStream({
                videoDeviceId: currentVideoDevice,
                audioDeviceId: currentAudioDevice,
                rtmpUrl: rtmpUrl1
            })

            if (result.success) {
                console.log(rtmpUrl1)
                setIsRtmpStreaming(true)
                setStreamError('')
            } else {
                setStreamError(result.message)
            }
        } catch (error) {
            console.error('Error starting RTMP stream:', error)
            if (error instanceof Error) {
                setStreamError(`Error: ${error?.message}`)
            }
        }
    }

    // Function to stop RTMP streaming
    const stopRtmpStreaming = async () => {
        try {
            const result = await window.api.stopRtmpStream()

            if (result.success) {
                setIsRtmpStreaming(false)
                setStreamDuration(0)
            } else {
                setStreamError(result.message)
            }
        } catch (error) {
            console.error('Error stopping RTMP stream:', error)
            if (error instanceof Error) {
                setStreamError(`Error: ${error.message}`)
            }
        }
    }

    const stopScreenRtmpStreaming = async () => {
        try {
            const result = await window.api.stopScreenRtmpStream()

            console.log(result)
            if (result.success) {
                setIsRtmpStreaming(false)
                setStreamDuration(0)
            } else {
                setStreamError(result.message)
            }
        } catch (error) {
            console.error('Error stopping RTMP stream:', error)
            if (error instanceof Error) {
                setStreamError(`Error: ${error.message}`)
            }
        }
    }

    // Format seconds to mm:ss
    const formatDuration = (seconds: number): string => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    // Change video device
    const handleVideoDeviceChange = (e: ChangeEvent<HTMLSelectElement>) => {
        setCurrentVideoDevice(e.target.value)
        if (activeDevice === 'camera') {
            void startCamera()
        }
    }

    const handleAudioDeviceChange = (e: ChangeEvent<HTMLSelectElement>) => {
        setCurrentAudioDevice(e.target.value)
        if (isMicrophoneActive) {
            void startMicrophone()
        }
    }

    const sendAll = async () => {
        await startCamera()
        await startMicrophone()
        await startRtmpStreaming()
        await startScreenRtmpStreaming()
    }

    const stopSend = async () => {
        await stopRtmpStreaming()
        await stopScreenRtmpStreaming()
    }

    return (
        <div
            className="device-test-container"
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                padding: '20px',
                color: 'white',
                fontFamily: 'Inter, sans-serif'
            }}
        >
            <h1 style={{ marginBottom: '20px', textAlign: 'center' }}>Device Testing Utility</h1>

            <div style={{ display: 'flex', gap: '20px', height: 'calc(100% - 100px)' }}>
                {/* Right panel for controls */}
                <div
                    style={{
                        flex: '1',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '20px',
                        overflow: 'auto'
                    }}
                >
                    {/* Device selection area */}
                    <div
                        style={{
                            backgroundColor: 'var(--ev-c-black-soft)',
                            padding: '15px',
                            borderRadius: '8px'
                        }}
                    >
                        <h3 style={{ marginBottom: '15px' }}>Device Selection</h3>

                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ display: 'block', marginBottom: '5px' }}>
                                Video Source:
                            </label>
                            <select
                                value={currentVideoDevice}
                                onChange={handleVideoDeviceChange}
                                style={{
                                    width: '100%',
                                    padding: '8px',
                                    backgroundColor: 'var(--ev-c-black-mute)',
                                    color: 'white',
                                    border: '1px solid var(--ev-c-gray-3)',
                                    borderRadius: '4px'
                                }}
                            >
                                {videoDevices.length === 0 && (
                                    <option value="">No cameras found</option>
                                )}
                                {videoDevices.map((device) => (
                                    <option key={device.deviceId} value={device.deviceId}>
                                        {device.label ||
                                            `Camera ${videoDevices.indexOf(device) + 1}`}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label style={{ display: 'block', marginBottom: '5px' }}>
                                Audio Source:
                            </label>
                            <select
                                value={currentAudioDevice}
                                onChange={handleAudioDeviceChange}
                                style={{
                                    width: '100%',
                                    padding: '8px',
                                    backgroundColor: 'var(--ev-c-black-mute)',
                                    color: 'white',
                                    border: '1px solid var(--ev-c-gray-3)',
                                    borderRadius: '4px'
                                }}
                            >
                                {audioDevices.length === 0 && (
                                    <option value="">No microphones found</option>
                                )}
                                {audioDevices.map((device) => (
                                    <option key={device.deviceId} value={device.deviceId}>
                                        {device.label ||
                                            `Microphone ${audioDevices.indexOf(device) + 1}`}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <button
                        onClick={sendAll}
                        style={{
                            padding: '10px',
                            backgroundColor:
                                activeDevice === 'camera'
                                    ? 'var(--ev-c-gray-1)'
                                    : 'var(--ev-c-gray-3)',
                            border: 'none',
                            borderRadius: '4px',
                            color: 'white',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px'
                        }}
                    >
                        <span style={{ fontSize: '18px' }}>📷</span>
                        <span>Send start</span>
                    </button>

                    <button onClick={stopSend}>Stop Send</button>

                    {/* RTMP Streaming controls */}
                    <div
                        style={{
                            backgroundColor: 'var(--ev-c-black-soft)',
                            padding: '15px',
                            borderRadius: '8px'
                        }}
                    >
                        <h3 style={{ marginBottom: '10px' }}>RTMP Streaming</h3>

                        <div style={{ marginBottom: '10px' }}>
                            <label style={{ display: 'block', marginBottom: '5px' }}>
                                RTMP URL:
                            </label>
                            <input
                                type="text"
                                value={rtmpUrl}
                                onChange={(e) => setRtmpUrl(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '8px',
                                    backgroundColor: 'var(--ev-c-black-mute)',
                                    color: 'white',
                                    border: '1px solid var(--ev-c-gray-3)',
                                    borderRadius: '4px'
                                }}
                            />
                        </div>

                        {isRtmpStreaming && (
                            <div
                                style={{
                                    marginTop: '10px',
                                    padding: '8px',
                                    backgroundColor: 'var(--ev-c-black-mute)',
                                    borderRadius: '4px',
                                    textAlign: 'center'
                                }}
                            >
                                Live: {formatDuration(streamDuration)}
                            </div>
                        )}

                        {isRtmpStreaming && (
                            <div
                                style={{
                                    marginTop: '10px',
                                    padding: '8px',
                                    backgroundColor: 'var(--ev-c-black-mute)',
                                    borderRadius: '4px',
                                    textAlign: 'center'
                                }}
                            >
                                Live: {formatDuration(streamDuration)}
                            </div>
                        )}

                        {streamError && (
                            <div
                                style={{
                                    marginTop: '10px',
                                    padding: '8px',
                                    backgroundColor: '#d32f2f',
                                    borderRadius: '4px',
                                    fontSize: '14px'
                                }}
                            >
                                {streamError}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default App
