import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { FluentProvider, webLightTheme, Spinner } from '@fluentui/react-components';
import logo from '../assets/logos/logo-principal.png';

// Lazy load step components
const Step1_File = lazy(() => import('./components/Step1_File'));
const Step2_Config = lazy(() => import('./components/Step2_Config'));
const Step3_Send = lazy(() => import('./components/Step3_Send'));
const Step4_Progress = lazy(() => import('./components/Step4_Progress'));

function App() {
    const [currentStep, setCurrentStep] = useState(1);
    const [campaign, setCampaign] = useState(null);
    const [qrCodeData, setQrCodeData] = useState('');
    const [sessionStatus, setSessionStatus] = useState('initializing');
    const [logs, setLogs] = useState([]);
    const [isApiReady, setIsApiReady] = useState(false); // New state to track API readiness
    const listenersSetupRef = useRef(false);

    useEffect(() => {
        const setupListeners = () => {
            window.electronAPI.on('campaign-update', (updatedCampaign) => {
                console.log("App.js: Received campaign-update:", updatedCampaign);
                setCampaign(updatedCampaign);
                if (updatedCampaign.status === 'running' || updatedCampaign.status === 'paused' || updatedCampaign.status === 'finished') {
                    setCurrentStep(4);
                }
            });

            window.electronAPI.on('qrcode', (url) => { // 'url' is now the data URL directly
                setQrCodeData(url);
                setSessionStatus('qr_received');
            });

            window.electronAPI.on('ready', () => {
                setSessionStatus('ready');
                console.log("App.js: sessionStatus set to ready");
            });
            window.electronAPI.on('auth-failure', () => setSessionStatus('auth_failure'));
            window.electronAPI.on('disconnected', () => {
                    setSessionStatus('disconnected');
                    alert('Se cerró la sesión de WhatsApp. La aplicación se cerrará, por favor vuelva abrir.');
                    window.electronAPI.forceQuitApp();
            });

            window.electronAPI.on('log-message', (message) => {
                console.log("App.js: log-message listener fired with:", message); // Add this line
                setLogs((prevLogs) => [...prevLogs, message]);
            });

            window.electronAPI.on('session-cleared', () => {
                handleStartNewCampaign(true); // Force reset
            });
        };

        const loadInitialData = async () => {
            // A short delay to ensure the preload script has run
            setTimeout(async () => {
                if (window.electronAPI) {
                    setIsApiReady(true); // Set API as ready
                    if (!listenersSetupRef.current) {
                        setupListeners();
                        listenersSetupRef.current = true;
                    }
                    const initialStatus = await window.electronAPI.getCampaignStatus();
                    console.log("App.js: Initial campaign status from main:", initialStatus);
                    if (initialStatus && initialStatus.id) {
                        setCampaign(initialStatus);
                        if (initialStatus.status !== 'inactive' && initialStatus.status !== 'stopped' && initialStatus.status !== 'finished') {
                            setCurrentStep(4); // Go to progress screen if campaign is active
                        }
                    }
                } else {
                    console.error("ElectronAPI is not available after delay.");
                    // Optionally, show an error to the user
                }
            }, 100); // 100ms delay as a fallback
        };

        loadInitialData();

        return () => {
            if (window.electronAPI && window.electronAPI.removeAllListeners) {
                window.electronAPI.removeAllListeners('campaign-update');
                window.electronAPI.removeAllListeners('qrcode');
                window.electronAPI.removeAllListeners('ready');
                window.electronAPI.removeAllListeners('auth-failure');
                window.electronAPI.removeAllListeners('disconnected');
                window.electronAPI.removeAllListeners('log-message');
                window.electronAPI.removeAllListeners('session-cleared');
            }
        };
    }, []);

    const handleStartNewCampaign = async (force = false) => {
        const confirmReset = force || window.confirm("¿Estás seguro de iniciar una nueva campaña? El progreso actual se perderá.");
        if (confirmReset) {
            try {
                if (window.electronAPI) {
                    const newCampaignState = await window.electronAPI.clearCampaignState();
                    setCampaign(newCampaignState);
                    const status = await window.electronAPI.getClientStatus();
                    setSessionStatus(status.status);
                }
                setCurrentStep(1);
                setLogs([]);
                setQrCodeData('');
            } catch (error) {
                console.error('Failed to start new campaign:', error);
                alert(`Se produjo un error al intentar limpiar la campaña anterior. Error: ${error.message}`);
            }
        }
    };

    const handleNextStep = async (configUpdate) => {
        const newConfig = { ...(campaign ? campaign.config : {}), ...configUpdate };
        if (window.electronAPI) {
            const updatedCampaign = await window.electronAPI.saveCampaignConfig(newConfig);
            setCampaign(updatedCampaign);
        }
        setCurrentStep(prev => prev + 1);
    };

    const handleBackStep = () => {
        setCurrentStep(prev => prev - 1);
    };

    const handleStartSending = () => {
        if (window.electronAPI && campaign && campaign.config) {
            window.electronAPI.startSending(campaign.config);
            setCurrentStep(4);
        }
    };

    const handlePauseCampaign = () => {
        if (window.electronAPI && campaign && campaign.id) {
            window.electronAPI.pauseSending(campaign.id);
        }
    };

    const handleResumeCampaign = () => {
        if (window.electronAPI && campaign && campaign.id) {
            window.electronAPI.resumeSending(campaign.id);
        }
    };

    const renderStep = () => {
        const initialConfig = campaign ? campaign.config : {};

        switch (currentStep) {
            case 1:
                return <Step1_File onNext={handleNextStep} electronAPI={window.electronAPI} initialConfig={initialConfig} />;
            case 2:
                return <Step2_Config onNext={handleNextStep} onBack={handleBackStep} electronAPI={window.electronAPI} initialConfig={initialConfig} />;
            case 3:
                return <Step3_Send onNext={handleStartSending} onBack={handleBackStep} electronAPI={window.electronAPI} campaign={campaign} qrCodeData={qrCodeData} sessionStatus={sessionStatus} setSessionStatus={setSessionStatus} setQrCodeData={setQrCodeData} />;
            case 4:
                return <Step4_Progress campaign={campaign} onPause={handlePauseCampaign} onResume={handleResumeCampaign} logs={logs} onStartNew={handleStartNewCampaign} sessionStatus={sessionStatus} qrCodeData={qrCodeData} onUpdateConfig={window.electronAPI?.updateCampaignConfig} />;
            default:
                return <div>Paso desconocido</div>;
        }
    };

    useEffect(() => {
        if (currentStep === 3 && isApiReady) {
            // Only initialize client if not already ready or showing QR
            if (sessionStatus !== 'ready' && sessionStatus !== 'qr_received') {
                console.log("App.js: Entering Step 3, initializing WhatsApp client...");
                window.electronAPI.initializeClient();
            }
        }
    }, [currentStep, isApiReady, sessionStatus]);

    return (
        <FluentProvider theme={webLightTheme}>
            <div className="app-container">
                <header className="app-header">
                    <img src={logo} className="app-logo" alt="logo" />
                </header>
                <div>
                    <h1>{currentStep === 1 ? 'Creación de nueva campaña' : ''}</h1>
                    {isApiReady ? (
                        <Suspense fallback={<Spinner label="Cargando..." />}>
                            {renderStep()}
                        </Suspense>
                    ) : <Spinner label="Inicializando..." />} 
                </div>
            </div>
        </FluentProvider>
    );
}

export default App;
