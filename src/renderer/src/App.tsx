import { useEffect, useRef, useState } from 'react'

function App() {
    // State hooks for managing different media streams
    const [activeDevice, setActiveDevice] = useState<string>('camera')
    const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
    const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
    const [currentVideoDevice, setCurrentVideoDevice] = useState<string>('')
    const [currentAudioDevice, setCurrentAudioDevice] = useState<string>('')
    const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false)
    const [isMicrophoneActive, setIsMicrophoneActive] = useState<boolean>(false)
    const [audioLevel, setAudioLevel] = useState<number>(0)

    // Screen sources and recording state
    const [screenSources, setScreenSources] = useState<Array<{id: string, name: string, thumbnail: string}>>([])
    const [selectedSource, setSelectedSource] = useState<string>('')
    const [isRecording, setIsRecording] = useState<boolean>(false)
    const [recordedVideo, setRecordedVideo] = useState<string | null>(null)

    // Refs for DOM elements
    const videoRef = useRef<HTMLVideoElement>(null)
    const recordedVideoRef = useRef<HTMLVideoElement>(null)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const recordedChunksRef = useRef<Blob[]>([])
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

        getDevices()

        // Get available screen sources from electron
        fetchScreenSources()

        // Set up device change listener
        navigator.mediaDevices.addEventListener('devicechange', getDevices)

        return () => {
            navigator.mediaDevices.removeEventListener('devicechange', getDevices)

            // Clean up audio analyzer
            if (animationFrameId.current) {
                cancelAnimationFrame(animationFrameId.current)
            }

            if (audioContext.current) {
                audioContext.current.close()
            }

            // Clean up recording
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop()
            }

            // Revoke object URL if one exists
            if (recordedVideo) {
                URL.revokeObjectURL(recordedVideo)
            }
        }
    }, [recordedVideo])

    // Fetch screen sources from Electron
    const fetchScreenSources = async () => {
        try {
            // Call the Electron API function via preload
            const sources = await window.api.getScreenSources()
            setScreenSources(sources)

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
                    const average =
                        audioDataArray.current.reduce((sum, value) => sum + value, 0) /
                        audioDataArray.current.length

                    setAudioLevel(average)
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
            audioContext.current.close()
            audioContext.current = null
        }

        setAudioLevel(0)
        setIsMicrophoneActive(false)
    }

    // Function to start screen sharing using Electron's desktopCapturer
    const startScreenShare = async () => {
        try {
            // Stop any existing streams
            stopAllStreams()

            if (!selectedSource) {
                alert("Please select a screen source first")
                return
            }

            // Create constraints for getUserMedia using the selected source ID
            const constraints = {
                audio: false,
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: selectedSource
                    }
                }
            } as any; // Type assertion needed for Electron-specific constraints

            const stream = await navigator.mediaDevices.getUserMedia(constraints)

            if (videoRef.current) {
                videoRef.current.srcObject = stream
            }

            setActiveDevice('screen')
            setIsScreenSharing(true)
        } catch (error) {
            console.error('Error sharing screen: ', error)
        }
    }

    // Function to stop all streams
    const stopAllStreams = () => {
        // Stop recording first if active
        if (isRecording) {
            stopRecording()
        }

        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream
            stream.getTracks().forEach((track) => track.stop())
            videoRef.current.srcObject = null
        }

        stopMicrophone()
    }

    // Start recording the current stream
    const startRecording = () => {
        // Clear previous recording if any
        if (recordedVideo) {
            URL.revokeObjectURL(recordedVideo)
            setRecordedVideo(null)
        }

        if (!videoRef.current?.srcObject) {
            alert('Please start a stream before recording')
            return
        }

        recordedChunksRef.current = []

        try {
            const stream = videoRef.current.srcObject as MediaStream

            // Create options with audio if needed
            let options = { mimeType: 'video/webm; codecs=vp9' }

            // Create media recorder
            const mediaRecorder = new MediaRecorder(stream, options)

            mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    recordedChunksRef.current.push(event.data)
                }
            }

            mediaRecorder.onstop = () => {
                // Create a blob from the recorded chunks
                const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' })
                const url = URL.createObjectURL(blob)
                setRecordedVideo(url)
            }

            // Start recording
            mediaRecorder.start(100) // Collect data every 100ms
            mediaRecorderRef.current = mediaRecorder
            setIsRecording(true)

        } catch (error) {
            console.error('Error starting recording:', error)
        }
    }

    // Stop recording
    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop()
            setIsRecording(false)
        }
    }

    // Save the recording as a file
    const downloadRecording = () => {
        if (!recordedVideo) return

        const a = document.createElement('a')
        document.body.appendChild(a)
        a.style.display = 'none'
        a.href = recordedVideo
        a.download = `screen-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`
        a.click()

        setTimeout(() => {
            document.body.removeChild(a)
        }, 100)
    }

    // Change video device
    const handleVideoDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setCurrentVideoDevice(e.target.value)
        if (activeDevice === 'camera') {
            startCamera()
        }
    }

    // Change audio device
    const handleAudioDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setCurrentAudioDevice(e.target.value)
        if (isMicrophoneActive) {
            startMicrophone()
        }
    }

    // Change screen source
    const handleSourceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedSource(e.target.value)
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
                {/* Left panel for video display */}
                <div style={{ flex: '3', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div
                        style={{
                            flex: '1',
                            backgroundColor: '#222',
                            borderRadius: '8px',
                            position: 'relative',
                            overflow: 'hidden'
                        }}
                    >
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain',
                                backgroundColor: '#000'
                            }}
                        />

                        {!videoRef.current?.srcObject && !isMicrophoneActive && (
                            <div
                                style={{
                                    position: 'absolute',
                                    top: '50%',
                                    left: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    color: '#666',
                                    textAlign: 'center'
                                }}
                            >
                                <div>No active media</div>
                                <div style={{ fontSize: '14px', marginTop: '10px' }}>
                                    Select a device from the options on the right
                                </div>
                            </div>
                        )}

                        {isMicrophoneActive && !videoRef.current?.srcObject && (
                            <div
                                style={{
                                    position: 'absolute',
                                    bottom: '20px',
                                    left: '0',
                                    width: '100%',
                                    padding: '0 20px',
                                    display: 'flex',
                                    justifyContent: 'center'
                                }}
                            >
                                <div
                                    style={{
                                        width: '80%',
                                        height: '30px',
                                        backgroundColor: '#333',
                                        borderRadius: '15px',
                                        overflow: 'hidden'
                                    }}
                                >
                                    <div
                                        style={{
                                            height: '100%',
                                            width: `${(audioLevel / 255) * 100}%`,
                                            backgroundColor: '#4CAF50',
                                            transition: 'width 0.1s'
                                        }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Recording display */}
                    {recordedVideo && (
                        <div style={{ flex: '1', backgroundColor: '#222', borderRadius: '8px', overflow: 'hidden' }}>
                            <video
                                ref={recordedVideoRef}
                                src={recordedVideo}
                                controls
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'contain',
                                    backgroundColor: '#000'
                                }}
                            />
                        </div>
                    )}
                </div>

                {/* Right panel for controls */}
                <div style={{ flex: '1', display: 'flex', flexDirection: 'column', gap: '20px' }}>
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

                        <div style={{ marginBottom: '15px' }}>
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

                        <div>
                            <label style={{ display: 'block', marginBottom: '5px' }}>
                                Screen Source:
                            </label>
                            <select
                                value={selectedSource}
                                onChange={handleSourceChange}
                                style={{
                                    width: '100%',
                                    padding: '8px',
                                    backgroundColor: 'var(--ev-c-black-mute)',
                                    color: 'white',
                                    border: '1px solid var(--ev-c-gray-3)',
                                    borderRadius: '4px'
                                }}
                            >
                                {screenSources.length === 0 && (
                                    <option value="">Loading screen sources...</option>
                                )}
                                {screenSources.map((source) => (
                                    <option key={source.id} value={source.id}>
                                        {source.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Control buttons */}
                    <div
                        style={{
                            backgroundColor: 'var(--ev-c-black-soft)',
                            padding: '15px',
                            borderRadius: '8px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px'
                        }}
                    >
                        <h3 style={{ marginBottom: '5px' }}>Media Controls</h3>

                        <button
                            onClick={startCamera}
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
                            <span>Camera</span>
                        </button>

                        <button
                            onClick={startMicrophone}
                            style={{
                                padding: '10px',
                                backgroundColor: isMicrophoneActive
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
                            <span style={{ fontSize: '18px' }}>🎤</span>
                            <span>{isMicrophoneActive ? 'Stop Microphone' : 'Microphone'}</span>
                        </button>

                        <button
                            onClick={startScreenShare}
                            style={{
                                padding: '10px',
                                backgroundColor:
                                    activeDevice === 'screen'
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
                            <span style={{ fontSize: '18px' }}>🖥️</span>
                            <span>Screen Capture</span>
                        </button>

                        <button
                            onClick={stopAllStreams}
                            style={{
                                padding: '10px',
                                backgroundColor: '#d32f2f',
                                border: 'none',
                                borderRadius: '4px',
                                color: 'white',
                                cursor: 'pointer',
                                marginTop: '5px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px'
                            }}
                        >
                            <span style={{ fontSize: '18px' }}>⏹️</span>
                            <span>Stop All</span>
                        </button>
                    </div>

                    {/* Recording controls */}
                    <div
                        style={{
                            backgroundColor: 'var(--ev-c-black-soft)',
                            padding: '15px',
                            borderRadius: '8px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px'
                        }}
                    >
                        <h3 style={{ marginBottom: '5px' }}>Recording Controls</h3>

                        <button
                            onClick={isRecording ? stopRecording : startRecording}
                            disabled={!videoRef.current?.srcObject}
                            style={{
                                padding: '10px',
                                backgroundColor: isRecording ? '#d32f2f' : '#2e7d32',
                                border: 'none',
                                borderRadius: '4px',
                                color: 'white',
                                cursor: videoRef.current?.srcObject ? 'pointer' : 'not-allowed',
                                opacity: videoRef.current?.srcObject ? 1 : 0.6,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px'
                            }}
                        >
                            <span style={{ fontSize: '18px' }}>{isRecording ? '⏹️' : '⏺️'}</span>
                            <span>{isRecording ? 'Stop Recording' : 'Start Recording'}</span>
                        </button>

                        {recordedVideo && (
                            <button
                                onClick={downloadRecording}
                                style={{
                                    padding: '10px',
                                    backgroundColor: 'var(--ev-c-gray-3)',
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
                                <span style={{ fontSize: '18px' }}>💾</span>
                                <span>Download Recording</span>
                            </button>
                        )}
                    </div>

                    {/* Status area */}
                    <div
                        style={{
                            backgroundColor: 'var(--ev-c-black-soft)',
                            padding: '15px',
                            borderRadius: '8px',
                            flex: '1'
                        }}
                    >
                        <h3 style={{ marginBottom: '15px' }}>Active Devices</h3>

                        <div style={{ fontSize: '14px' }}>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    padding: '8px 0',
                                    borderBottom: '1px solid var(--ev-c-gray-3)'
                                }}
                            >
                                <span>Camera</span>
                                <span
                                    style={{
                                        color: activeDevice === 'camera' ? '#4CAF50' : '#999'
                                    }}
                                >
                                    {activeDevice === 'camera' ? 'Active' : 'Inactive'}
                                </span>
                            </div>

                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    padding: '8px 0',
                                    borderBottom: '1px solid var(--ev-c-gray-3)'
                                }}
                            >
                                <span>Microphone</span>
                                <span
                                    style={{
                                        color: isMicrophoneActive ? '#4CAF50' : '#999'
                                    }}
                                >
                                    {isMicrophoneActive ? 'Active' : 'Inactive'}
                                </span>
                            </div>

                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    padding: '8px 0',
                                    borderBottom: '1px solid var(--ev-c-gray-3)'
                                }}
                            >
                                <span>Screen Capture</span>
                                <span
                                    style={{
                                        color: activeDevice === 'screen' ? '#4CAF50' : '#999'
                                    }}
                                >
                                    {activeDevice === 'screen' ? 'Active' : 'Inactive'}
                                </span>
                            </div>

                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    padding: '8px 0'
                                }}
                            >
                                <span>Recording</span>
                                <span
                                    style={{
                                        color: isRecording ? '#4CAF50' : '#999'
                                    }}
                                >
                                    {isRecording ? 'Active' : 'Inactive'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default App
