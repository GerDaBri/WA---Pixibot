import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { FluentProvider, webLightTheme, Spinner, Text, Dialog, DialogTrigger, DialogSurface, DialogTitle, DialogBody, DialogActions, Button } from '@fluentui/react-components';
import UpdateNotification from './components/UpdateNotification';
import Sidebar from './components/Sidebar';

// Lazy load step components
const Step0_Login = lazy(() => import('./components/Step0_Login'));
const Step1_File = lazy(() => import('./components/Step1_File'));
const Step2_Config = lazy(() => import('./components/Step2_Config'));
const Step3_Send = lazy(() => import('./components/Step3_Send'));
const Step4_Progress = lazy(() => import('./components/Step4_Progress'));

function App() {
    const [currentStep, setCurrentStep] = useState(0); // Start with login
    const [licenseStatus, setLicenseStatus] = useState(null); // null, 'valid', 'expired', 'checking', 'suspended'
    const [licenseMessage, setLicenseMessage] = useState(''); // Message to display for license status
    const [licenseDetails, setLicenseDetails] = useState(null); // Store complete license information
    const [userData, setUserData] = useState(null); // Store user information
    const [campaign, setCampaign] = useState(null);
    const [qrCodeData, setQrCodeData] = useState('');
    const [sessionStatus, setSessionStatus] = useState('initializing');
    const [logs, setLogs] = useState([]);
    const [isApiReady, setIsApiReady] = useState(false); // New state to track API readiness
    
    // Update notification states
    const [updateStatus, setUpdateStatus] = useState('idle');
    const [updateInfo, setUpdateInfo] = useState(null);
    const [downloadProgress, setDownloadProgress] = useState(null);
    const [updateError, setUpdateError] = useState(null);

    // Closing overlay states
    const [isClosing, setIsClosing] = useState(false);
    const [closingStatus, setClosingStatus] = useState('Cerrando aplicación...');

    const listenersSetupRef = useRef(false);
    const clientInitializedForStep3Ref = useRef(false); // Track if client was initialized for current Step 3 session
    const clientStatusPollingRef = useRef(null); // Reference for polling interval
    const updateListenersRef = useRef(null); // Reference for update listeners cleanup
    const closingListenersRef = useRef(null); // Reference for closing listeners cleanup

    useEffect(() => {
        const setupListeners = () => {
            window.electronAPI.on('campaign-update', (updatedCampaign) => {
                console.log("App.js: Received campaign-update:", updatedCampaign);
                setCampaign(updatedCampaign);
                if (updatedCampaign.status === 'running' || updatedCampaign.status === 'paused' || updatedCampaign.status === 'finished') {
                    setCurrentStep(4);
                }
            });

            window.electronAPI.on('countdown-update', (countdownData) => {
                // Update campaign with countdown data
                setCampaign(prevCampaign => {
                    if (prevCampaign) {
                        return {
                            ...prevCampaign,
                            countdown: countdownData
                        };
                    }
                    return prevCampaign;
                });
            });

            window.electronAPI.on('qrcode', (url) => { // 'url' is now the data URL directly
                setQrCodeData(url);
                // Solo cambiar a 'qr_received' si el QR es válido (no vacío)
                if (url && url.trim() !== '') {
                    setSessionStatus('qr_received');
                }
            });

            window.electronAPI.on('ready', () => {
                console.log("🎉 App.js: 'ready' event received from main process!");
                console.log("🔄 App.js: Changing sessionStatus from", sessionStatus, "to 'ready'");
                setSessionStatus('ready');
                setQrCodeData('');
                console.log("✅ App.js: sessionStatus set to ready");
                window.electronAPI.send('log-message', '🎉 App.js: ready event received, setting sessionStatus to ready');
            });
            window.electronAPI.on('auth-failure', () => {
                console.log("App.js: 'auth-failure' event received - changing sessionStatus from", sessionStatus, "to 'auth_failure'");
                setSessionStatus('auth_failure');
            });
            window.electronAPI.on('disconnected', () => {
                console.log("App.js: 'disconnected' event received - auto-reconnecting");
                setQrCodeData(''); // Clear previous QR code
                handleReconnect(); // Automatically reconnect
                setSessionStatus('initializing'); // Set to initializing to show spinner
            });

            window.electronAPI.on('browser-closed', (message) => {
                console.log("App.js: 'browser-closed' event received:", message);
                setQrCodeData(''); // Clear previous QR code
                handleReconnect();
                setSessionStatus('initializing');
            });

            window.electronAPI.on('log-message', (message) => {
                console.log("App.js: log-message listener fired with:", message); // Add this line
                setLogs((prevLogs) => [...prevLogs, message]);
            });

            window.electronAPI.on('session-cleared', () => {
                handleStartNewCampaign(true); // Force reset
            });
        };

        const setupUpdateListeners = () => {
            if (!window.electronAPI?.updateEvents) return;

            const unsubscribeAvailable = window.electronAPI.updateEvents.onUpdateAvailable((info) => {
                console.log('App.js: Update available:', info);
                setUpdateStatus('available');
                setUpdateInfo(info);
                setUpdateError(null);

                // Iniciar descarga automáticamente
                setTimeout(() => {
                    console.log('App.js: Auto-starting download for available update');
                    if (window.electronAPI?.downloadUpdate) {
                        window.electronAPI.downloadUpdate();
                    }
                }, 1000); // Esperar 1 segundo para mostrar el mensaje
            });

            const unsubscribeProgress = window.electronAPI.updateEvents.onDownloadProgress((progress) => {
                console.log('App.js: Download progress:', progress);
                setUpdateStatus('downloading');
                setDownloadProgress(progress);
            });

            const unsubscribeDownloaded = window.electronAPI.updateEvents.onUpdateDownloaded((info) => {
                console.log('App.js: Update downloaded:', info);
                setUpdateStatus('downloaded');
                setUpdateInfo(info);
                setDownloadProgress(null);
            });

            const unsubscribeError = window.electronAPI.updateEvents.onUpdateError((error) => {
                console.log('App.js: Update error:', error);
                setUpdateStatus('error');
                setUpdateError(error);
            });

            // Store cleanup functions
            updateListenersRef.current = () => {
                unsubscribeAvailable();
                unsubscribeProgress();
                unsubscribeDownloaded();
                unsubscribeError();
            };
        };

        const setupClosingListeners = () => {
            if (!window.electronAPI?.onShowClosingOverlay || !window.electronAPI?.onUpdateClosingStatus) return;

            const unsubscribeShow = window.electronAPI.onShowClosingOverlay(() => {
                console.log('App.js: Showing closing overlay');
                setIsClosing(true);
                setClosingStatus('Cerrando aplicación...');
            });

            const unsubscribeStatus = window.electronAPI.onUpdateClosingStatus((status) => {
                console.log('App.js: Closing status update:', status);
                setClosingStatus(status);
            });

            // Store cleanup functions
            closingListenersRef.current = () => {
                unsubscribeShow();
                unsubscribeStatus();
            };
        };

        const loadInitialData = async () => {
            // A short delay to ensure the preload script has run
            setTimeout(async () => {
                if (window.electronAPI) {
                    setIsApiReady(true); // Set API as ready
                    if (!listenersSetupRef.current) {
                        setupListeners();
                        setupUpdateListeners(); // Setup update listeners
                        setupClosingListeners(); // Setup closing overlay listeners
                        listenersSetupRef.current = true;
                    }

                    // First, check license status
                    setLicenseStatus('checking');
                    setLicenseMessage('Verificando licencia...');
                    console.log('App.js: Starting license check after app initialization');
                    try {
                        const licenseCheckStart = Date.now();
                        const licenseCheck = await window.electronAPI.checkLicenseStatus();
                        const licenseCheckEnd = Date.now();
                        console.log(`App.js: License check completed in ${licenseCheckEnd - licenseCheckStart}ms, result:`, licenseCheck);
                        if (licenseCheck.valid) {
                            console.log('App.js: License validation successful');
                        } else {
                            console.log('App.js: License validation failed:', licenseCheck.reason);
                        }

                        if (licenseCheck.valid) {
                            // Always recalculate days remaining on app startup to ensure it's current
                            console.log('App.js: Recalculating days remaining on app startup...');
                            try {
                                const recalcResult = await window.electronAPI.recalculateDaysRemaining();
                                if (recalcResult.success) {
                                    licenseCheck.license.days_remaining = recalcResult.days_remaining;
                                    console.log('App.js: Days remaining recalculated:', recalcResult.days_remaining);
                                }
                            } catch (error) {
                                console.error('App.js: Error recalculating days remaining:', error);
                            }

                            setLicenseStatus('valid');
                            setLicenseDetails(licenseCheck.license);
                            setUserData(licenseCheck.user);
                            setLicenseMessage(`Licencia válida - ${licenseCheck.license?.days_remaining || 0} días restantes`);
                            setCurrentStep(1); // Proceed to main app
                        } else {
                            // Handle different license states
                            const licenseReason = licenseCheck.reason || 'invalid';

                            // Don't treat no_license or no_license_data as errors - user can still login
                            if (licenseReason === 'no_license_data' || licenseReason === 'no_license') {
                                setLicenseStatus(licenseReason);
                                setLicenseMessage('Verifique sus credenciales para acceder');
                                setCurrentStep(0); // Stay on login but allow login
                            } else {
                                setLicenseStatus(licenseReason);
                                setLicenseDetails(licenseCheck.license);
                                setUserData(licenseCheck.user);
                                setLicenseMessage(licenseCheck.message || 'Licencia inválida');
                                setCurrentStep(0); // Stay on login
                            }
                        }
                    } catch (error) {
                        console.error('License check failed:', error);
                        setLicenseStatus('error');
                        setLicenseMessage('Error al verificar licencia');
                        setCurrentStep(0);
                    }

                    // ALWAYS check for campaign status regardless of license status
                    // This ensures we can resume campaigns even during license validation
                    console.log("🔍 App.js: Checking campaign status - licenseStatus:", licenseStatus);
                    const initialStatus = await window.electronAPI.getCampaignStatus();
                    console.log("📊 App.js: Initial campaign status from main:", initialStatus);
                    if (initialStatus && initialStatus.id) {
                        console.log("✅ App.js: Found active campaign, setting campaign state");
                        setCampaign(initialStatus);
                        if (initialStatus.status !== 'inactive' && initialStatus.status !== 'stopped' && initialStatus.status !== 'finished') {
                            console.log("🚀 App.js: Campaign is active, navigating to step 4. Status:", initialStatus.status);
                            setCurrentStep(4); // Go to progress screen if campaign is active
                        } else {
                            console.log("⏸️ App.js: Campaign exists but is not active. Status:", initialStatus.status);
                        }
                    } else {
                        console.log("❌ App.js: No active campaign found");
                    }

                    // ALWAYS check initial client status to set sessionStatus correctly (regardless of license)
                    console.log("🔍 App.js: Checking initial client status...");
                    const initialClientStatus = await window.electronAPI.getClientStatus();
                    console.log("📊 App.js: Initial client status:", initialClientStatus);
                    
                    if (initialClientStatus.status === 'ready') {
                        console.log("✅ App.js: Client is ready - setting sessionStatus to 'ready'");
                        setSessionStatus('ready');
                    } else if (initialClientStatus.status === 'initializing') {
                        console.log("⏳ App.js: Client is initializing - setting sessionStatus to 'initializing'");
                        setSessionStatus('initializing');
                    } else if (initialClientStatus.status === 'not_ready') {
                        console.log("📱 App.js: Client not ready (QR pending) - setting sessionStatus to 'qr_received'");
                        setSessionStatus('qr_received');
                } else {
                    console.log("❌ App.js: Client disconnected - auto-reconnecting");
                    setQrCodeData(''); // Clear previous QR code
                    handleReconnect();
                    setSessionStatus('initializing');
                }

                    // Start polling for client status if it's initializing
                    if (initialClientStatus.status === 'initializing') {
                        console.log("🔄 App.js: Client is initializing - starting status polling...");
                        startClientStatusPolling();
                    }
                } else {
                    console.error("ElectronAPI is not available after delay.");
                    // Optionally, show an error to the user
                }
            }, 100); // 100ms delay as a fallback
        };

        loadInitialData();

        return () => {
            // Clean up polling interval
            if (clientStatusPollingRef.current) {
                console.log("🧹 App.js: Cleaning up client status polling");
                clearInterval(clientStatusPollingRef.current);
                clientStatusPollingRef.current = null;
            }
            
            // Clean up update listeners
            if (updateListenersRef.current) {
                console.log("🧹 App.js: Cleaning up update listeners");
                updateListenersRef.current();
                updateListenersRef.current = null;
            }
            
            if (window.electronAPI && window.electronAPI.removeAllListeners) {
                window.electronAPI.removeAllListeners('campaign-update');
                window.electronAPI.removeAllListeners('countdown-update');
                window.electronAPI.removeAllListeners('qrcode');
                window.electronAPI.removeAllListeners('ready');
                window.electronAPI.removeAllListeners('auth-failure');
                window.electronAPI.removeAllListeners('disconnected');
                window.electronAPI.removeAllListeners('log-message');
                window.electronAPI.removeAllListeners('session-cleared');
            }
        };
    }, []);

    // Monitor sessionStatus changes to restart polling if needed
    useEffect(() => {
        console.log("🔍 App.js: sessionStatus changed to:", sessionStatus);
        
        // If sessionStatus changes to 'initializing' and polling is not active, start it
        if (sessionStatus === 'initializing' && !clientStatusPollingRef.current) {
            console.log("🔄 App.js: sessionStatus changed to 'initializing' - starting polling");
            startClientStatusPolling();
        }
        
        // If sessionStatus changes to 'qr_received' and polling is not active, start it
        if (sessionStatus === 'qr_received' && !clientStatusPollingRef.current) {
            console.log("🔄 App.js: sessionStatus changed to 'qr_received' - starting polling");
            startClientStatusPolling();
        }

        // Optimize polling: reduce frequency or add conditions to avoid excessive calls
        if (clientStatusPollingRef.current) {
            // Example: only poll if not ready and not too frequently
            clearInterval(clientStatusPollingRef.current);
            clientStatusPollingRef.current = setInterval(async () => {
                const status = await window.electronAPI.getClientStatus();
                if (status.status === 'ready') {
                    clearInterval(clientStatusPollingRef.current);
                    clientStatusPollingRef.current = null;
                    setSessionStatus('ready');
                } else if (status.status === 'disconnected') {
                    clearInterval(clientStatusPollingRef.current);
                    clientStatusPollingRef.current = null;
                    setQrCodeData(''); // Clear previous QR code
                    handleReconnect();
                    setSessionStatus('initializing');
                }
                // Only log if status changes to avoid spam
            }, 2000); // Increase interval to 2 seconds
        }
    }, [sessionStatus]);

    // Function to start polling client status
    const startClientStatusPolling = () => {
        if (clientStatusPollingRef.current) {
            console.log("⚠️ App.js: Polling already active, skipping");
            return;
        }

        console.log("🔄 App.js: Starting client status polling every 2 seconds...");
        clientStatusPollingRef.current = setInterval(async () => {
            try {
                const status = await window.electronAPI.getClientStatus();
                console.log("📊 App.js: Polling - client status:", status);
                
                if (status.status === 'ready') {
                    console.log("✅ App.js: Polling detected client is ready - updating sessionStatus");
                    setSessionStatus('ready');
                    // Stop polling once ready
                    clearInterval(clientStatusPollingRef.current);
                    clientStatusPollingRef.current = null;
                    console.log("🛑 App.js: Stopped client status polling - client is ready");
                } else if (status.status === 'not_ready') {
                    console.log("📱 App.js: Polling detected QR needed - updating sessionStatus");
                    setSessionStatus('qr_received');
                } else if (status.status === 'initializing') {
                    console.log("⏳ App.js: Polling detected client initializing - updating sessionStatus");
                    setSessionStatus('initializing');
                } else if (status.status === 'disconnected') {
                    console.log("❌ App.js: Polling detected client disconnected - auto-reconnecting");
                    setQrCodeData(''); // Clear previous QR code
                    handleReconnect();
                    setSessionStatus('initializing');
                    // Stop polling on disconnect
                    clearInterval(clientStatusPollingRef.current);
                    clientStatusPollingRef.current = null;
                    console.log("🛑 App.js: Stopped client status polling - client disconnected");
                }
            } catch (error) {
                console.error("❌ App.js: Error during client status polling:", error);
            }
        }, 5000); // Poll every 5 seconds
    };

    // Function to stop polling
    const stopClientStatusPolling = () => {
        if (clientStatusPollingRef.current) {
            console.log("🛑 App.js: Stopping client status polling");
            clearInterval(clientStatusPollingRef.current);
            clientStatusPollingRef.current = null;
        }
    };

    const handleLoginSuccess = async (loginResult) => {
        console.log('Login success result:', loginResult);
        console.log('App.js: Setting license status to valid after successful login');
        setLicenseStatus('valid');
        setLicenseDetails(loginResult.license);
        setUserData(loginResult.user);
        setLicenseMessage(`Licencia válida - ${loginResult.license?.days_remaining || 0} días restantes`);
        
        // Check for active campaigns after successful login
        console.log('🔍 App.js: Checking for active campaigns after login...');
        try {
            const campaignStatus = await window.electronAPI.getCampaignStatus();
            console.log('📊 App.js: Campaign status after login:', campaignStatus);
            
            if (campaignStatus && campaignStatus.id) {
                console.log('✅ App.js: Found active campaign after login, setting campaign state');
                setCampaign(campaignStatus);
                if (campaignStatus.status !== 'inactive' && campaignStatus.status !== 'stopped' && campaignStatus.status !== 'finished') {
                    console.log('🚀 App.js: Campaign is active after login, navigating to step 4. Status:', campaignStatus.status);
                    setCurrentStep(4); // Go directly to progress screen if campaign is active
                } else {
                    console.log('⏸️ App.js: Campaign exists but is not active after login. Status:', campaignStatus.status);
                    setCurrentStep(1); // Proceed to main app
                }
            } else {
                console.log('❌ App.js: No active campaign found after login');
                setCurrentStep(1); // Proceed to main app
            }
        } catch (error) {
            console.error('❌ App.js: Error checking campaign status after login:', error);
            setCurrentStep(1); // Fallback to main app on error
        }
    };

    const handleStartNewCampaign = async (force = false) => {
        const confirmReset = force || window.confirm("¿Estás seguro de iniciar una nueva campaña? El progreso actual se perderá.");
        if (confirmReset) {
            try {
                if (window.electronAPI) {
                    const newCampaignState = await window.electronAPI.clearCampaignState();
                    setCampaign(newCampaignState);
                    const status = await window.electronAPI.getClientStatus();
                    // Map 'not_ready' to 'qr_received' for consistency, as polling does
                    setSessionStatus(status.status === 'not_ready' ? 'qr_received' : status.status);
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
        console.log("🔄 App.js: handleNextStep called - current step:", currentStep, "will become:", currentStep + 1);
        const newConfig = { ...(campaign ? campaign.config : {}), ...configUpdate };
        if (window.electronAPI) {
            const updatedCampaign = await window.electronAPI.saveCampaignConfig(newConfig);
            setCampaign(updatedCampaign);
        }
        const newStep = currentStep + 1;
        console.log("📍 App.js: Setting currentStep to:", newStep);
        setCurrentStep(newStep);
    };

    const handleBackStep = () => {
        console.log("⬅️ App.js: handleBackStep called - current step:", currentStep, "will become:", currentStep - 1);
        const newStep = currentStep - 1;
        console.log("📍 App.js: Setting currentStep to:", newStep);
        setCurrentStep(newStep);
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

    // Update notification handlers
    const handleDownloadUpdate = () => {
        console.log('App.js: Starting update download');
        setUpdateStatus('downloading');
        if (window.electronAPI?.downloadUpdate) {
            window.electronAPI.downloadUpdate();
        }
    };

    const handleInstallUpdate = () => {
        console.log('App.js: Installing update');
        if (window.electronAPI?.installUpdate) {
            window.electronAPI.installUpdate();
        }
    };

    const handleIgnoreUpdate = () => {
        console.log('App.js: Ignoring update');
        setUpdateStatus('idle');
        setUpdateInfo(null);
        setUpdateError(null);
    };

    const handleRetryUpdate = () => {
        console.log('App.js: Retrying update');
        setUpdateError(null);
        setUpdateStatus('checking');
        if (window.electronAPI?.checkForUpdates) {
            window.electronAPI.checkForUpdates();
        }
    };

    const handleCloseNotification = () => {
        console.log('App.js: Closing update notification');
        setUpdateStatus('idle');
        setUpdateInfo(null);
        setDownloadProgress(null);
        setUpdateError(null);
    };

    const handleReconnect = () => {
        console.log('App.js: Reconnecting...');
        if (window.electronAPI) {
            window.electronAPI.initializeClient();
        }
    };

    const handleLogout = async () => {
        console.log('App.js: Logging out...');
        if (window.electronAPI) {
            await window.electronAPI.logout();
            setSessionStatus('disconnected');
        }
    };

    const renderStep = () => {
        // Block access if license is invalid and not on login step
        if ((licenseStatus === 'expired' || licenseStatus === 'suspended' || licenseStatus === 'no_license' || licenseStatus === 'no_license_data' || licenseStatus === 'error') && currentStep > 0) {
            return (
                <div style={{ textAlign: 'center', padding: '50px' }}>
                    <h2>Licencia Inválida</h2>
                    <p>{licenseMessage}</p>
                    <button onClick={() => setCurrentStep(0)}>Ir al Login</button>
                </div>
            );
        }

        const initialConfig = campaign ? campaign.config : {};

        switch (currentStep) {
            case 0:
                // Show license message on login step if there's an issue (but not for no_license_data or no_license since user can still login)
                const showLicenseWarning = licenseStatus === 'expired' || licenseStatus === 'suspended' || licenseStatus === 'error';
                console.log('App.js: Rendering login step - licenseStatus:', licenseStatus, 'showLicenseWarning:', showLicenseWarning, 'licenseMessage:', licenseMessage);
                return (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        padding: '40px 20px 20px 20px',
                    }}>
                        {showLicenseWarning && (
                            <div style={{
                                width: '320px',
                                backgroundColor: '#ffebee',
                                border: '1px solid #f44336',
                                borderRadius: '8px',
                                padding: '16px',
                                marginBottom: '20px',
                                textAlign: 'center'
                            }}>
                                <p style={{ color: '#d32f2f', margin: 0, fontSize: '14px' }}>{licenseMessage}</p>
                            </div>
                        )}
                        <Step0_Login onLoginSuccess={handleLoginSuccess} />
                    </div>
                );
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
        console.log("🔍 App.js: useEffect triggered - currentStep:", currentStep, "isApiReady:", isApiReady, "sessionStatus:", sessionStatus);
        
        // Reset the initialization flag when leaving Step 3
        if (currentStep !== 3) {
            if (clientInitializedForStep3Ref.current) {
                console.log("🔄 App.js: Leaving Step 3, resetting initialization flag");
                clientInitializedForStep3Ref.current = false;
            }
            return;
        }
        
        // DISABLED: No automatic initialization in useEffect
        // The client should already be initialized from app startup
        // Only manual reconnection through the "Reconectar" button should trigger initialization
        console.log("⚠️ App.js: In Step 3 - AUTOMATIC INITIALIZATION DISABLED");
        console.log("ℹ️ App.js: Client should already be ready from startup, or user can use Reconnect button");
        
    }, [currentStep, isApiReady, sessionStatus]);

    const getLicenseStatusText = () => {
        if (licenseStatus === 'checking') return 'Verificando licencia...';
        if (licenseStatus === 'valid' && licenseDetails) {
            return `Licencia válida - ${licenseDetails.days_remaining || 0} días`;
        }
        return licenseMessage || '';
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    return (
        <FluentProvider theme={webLightTheme}>
            <div className="app-container">
                {/* Update Notification - Global component */}
                <UpdateNotification
                    status={updateStatus}
                    updateInfo={updateInfo}
                    downloadProgress={downloadProgress}
                    error={updateError}
                    onDownload={handleDownloadUpdate}
                    onInstall={handleInstallUpdate}
                    onIgnore={handleIgnoreUpdate}
                    onRetry={handleRetryUpdate}
                    onClose={handleCloseNotification}
                />

                {/* Sidebar - Only show after login */}
                {currentStep > 0 && (
                    <Sidebar
                        currentStep={currentStep}
                        sessionStatus={sessionStatus}
                        licenseDetails={licenseDetails}
                        userData={userData}
                    />
                )}

                {/* Main Content Area */}
                <div className="app-main-content">
                    <header className="app-header">
                        <div className="app-header-left">
                            <h1 className="app-header-title">
                                {currentStep === 0 && 'Inicio de Sesión'}
                                {currentStep === 1 && 'Creación de Nueva Campaña'}
                                {currentStep === 2 && 'Configuración del Mensaje'}
                                {currentStep === 3 && 'Conexión con WhatsApp'}
                                {currentStep === 4 && `Campaña: ${campaign?.config?.campaignName || 'En Progreso'}`}
                            </h1>
                        </div>

                        {licenseStatus && currentStep > 0 && (
                            <Dialog>
                                <DialogTrigger disableButtonEnhancement>
                                    <Button
                                        appearance="subtle"
                                        style={{
                                            fontSize: '14px',
                                            color: licenseStatus === 'valid' ? '#107c10' : '#d13438',
                                        }}
                                    >
                                        Ver Licencia
                                    </Button>
                                </DialogTrigger>
                                <DialogSurface>
                                    <DialogTitle>Información de Licencia</DialogTitle>
                                    <DialogBody>
                                        {userData && (
                                            <div style={{ marginBottom: '16px' }}>
                                                <h4 style={{ margin: '0 0 8px 0', color: '#323130' }}>Usuario</h4>
                                            <p style={{ margin: '4px 0', fontSize: '14px' }}>
                                                <strong>Email:</strong> {userData.email}
                                            </p>
                                            {userData.name && (
                                                <p style={{ margin: '4px 0', fontSize: '14px' }}>
                                                    <strong>Nombre:</strong> {userData.name}
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    {licenseDetails && (
                                        <div>
                                            <h4 style={{ margin: '0 0 8px 0', color: '#323130' }}>Licencia</h4>
                                            <p style={{ margin: '4px 0', fontSize: '14px' }}>
                                                <strong>Tipo:</strong> {licenseDetails.type || 'N/A'}
                                            </p>
                                            <p style={{ margin: '4px 0', fontSize: '14px' }}>
                                                <strong>Estado:</strong>
                                                <span style={{
                                                    color: licenseDetails.status === 'active' ? '#107c10' :
                                                          licenseDetails.status === 'suspended' ? '#d13438' : '#605e5c',
                                                    fontWeight: '500'
                                                }}>
                                                    {' ' + (licenseDetails.status === 'active' ? 'Activa' :
                                                          licenseDetails.status === 'suspended' ? 'Suspendida' : 'Expirada')}
                                                </span>
                                            </p>
                                            <p style={{ margin: '4px 0', fontSize: '14px' }}>
                                                <strong>Fecha de inicio:</strong> {formatDate(licenseDetails.start_date)}
                                            </p>
                                            <p style={{ margin: '4px 0', fontSize: '14px' }}>
                                                <strong>Fecha de expiración:</strong> {formatDate(licenseDetails.end_date)}
                                            </p>
                                            <p style={{ margin: '4px 0', fontSize: '14px' }}>
                                                <strong>Días restantes:</strong>
                                                <span style={{
                                                    color: (licenseDetails.days_remaining || 0) <= 7 ? '#d13438' :
                                                          (licenseDetails.days_remaining || 0) <= 30 ? '#d13438' : '#107c10',
                                                    fontWeight: '500'
                                                }}>
                                                    {' ' + (licenseDetails.days_remaining || 0)}
                                                </span>
                                            </p>
                                            {licenseDetails.is_expired && (
                                                <p style={{ margin: '8px 0', fontSize: '14px', color: '#d13438', fontWeight: '500' }}>
                                                    ⚠️ Esta licencia ha expirado
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </DialogBody>
                                <DialogActions>
                                    <Button
                                        appearance="secondary"
                                        onClick={async () => {
                                            if (window.confirm('¿Está seguro de que desea resetear los datos de licencia? Esto requerirá iniciar sesión nuevamente.')) {
                                                console.log('App.js: Starting license reset process');
                                                try {
                                                    const resetStart = Date.now();
                                                    const result = await window.electronAPI.resetLicenseData();
                                                    const resetEnd = Date.now();
                                                    console.log(`App.js: License reset completed in ${resetEnd - resetStart}ms, result:`, result);

                                                    if (result.success) {
                                                        console.log('App.js: License reset successful, initiating page reload');
                                                        alert('Datos de licencia reseteados exitosamente. La aplicación se reiniciará.');
                                                        const reloadStart = Date.now();
                                                        window.location.reload();
                                                        console.log(`App.js: Page reload initiated at ${reloadStart}`);
                                                    } else {
                                                        console.log('App.js: License reset failed:', result.error);
                                                        alert('Error al resetear datos de licencia: ' + result.error);
                                                    }
                                                } catch (error) {
                                                    console.log('App.js: License reset error:', error);
                                                    alert('Error al resetear datos de licencia: ' + error.message);
                                                }
                                            }
                                        }}
                                    >
                                        Resetear Licencia
                                    </Button>
                                    <DialogTrigger disableButtonEnhancement>
                                        <Button appearance="primary">Cerrar</Button>
                                    </DialogTrigger>
                                </DialogActions>
                            </DialogSurface>
                        </Dialog>
                    )}
                    </header>

                    {/* Content Area */}
                    <div className="app-content">
                        {isApiReady ? (
                            <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}><Spinner size="large" label="Cargando..." /></div>}>
                                {renderStep()}
                            </Suspense>
                        ) : (
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                                <Spinner size="large" label="Inicializando..." />
                            </div>
                        )}
                    </div>
                </div>

                {/* Closing Overlay */}
                {isClosing && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10000,
                        color: 'white'
                    }}>
                        <Spinner size="extra-large" style={{ marginBottom: '20px' }} />
                        <Text size={500} style={{ color: 'white', marginTop: '16px' }}>
                            {closingStatus}
                        </Text>
                    </div>
                )}
            </div>
        </FluentProvider>
    );
}

export default App;
