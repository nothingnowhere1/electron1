import {useEffect, useRef} from "react";

function App() {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        const getCameraStream = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({video: true});
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }
            } catch (error) {
                console.error('Error accessing camera: ', error);
            }
        };

        void getCameraStream();
    }, []);

    return (
        <div>
            asasassaasassa
        </div>
    );
}

export default App
