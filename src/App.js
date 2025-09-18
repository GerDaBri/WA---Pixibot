import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { FluentProvider, webLightTheme, Spinner, Text, Dialog, DialogTrigger, DialogSurface, DialogTitle, DialogBody, DialogActions, Button } from '@fluentui/react-components';
import logo from '../assets/logos/logo-principal.png';

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

                    // Then load campaign status if license is valid
                    if (licenseStatus === 'valid') {
                        const initialStatus = await window.electronAPI.getCampaignStatus();
                        console.log("App.js: Initial campaign status from main:", initialStatus);
                        if (initialStatus && initialStatus.id) {
                            setCampaign(initialStatus);
                            if (initialStatus.status !== 'inactive' && initialStatus.status !== 'stopped' && initialStatus.status !== 'finished') {
                                setCurrentStep(4); // Go to progress screen if campaign is active
                            }
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

    const handleLoginSuccess = async (loginResult) => {
        console.log('Login success result:', loginResult);
        console.log('App.js: Setting license status to valid after successful login');
        setLicenseStatus('valid');
        setLicenseDetails(loginResult.license);
        setUserData(loginResult.user);
        setLicenseMessage(`Licencia válida - ${loginResult.license?.days_remaining || 0} días restantes`);
        setCurrentStep(1); // Proceed to main app
    };

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
        if (currentStep === 3 && isApiReady) {
            // Only initialize client if not already ready or showing QR
            if (sessionStatus !== 'ready' && sessionStatus !== 'qr_received') {
                console.log("App.js: Entering Step 3, initializing WhatsApp client...");
                window.electronAPI.initializeClient();
            }
        }
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
                <header className="app-header">
                    <img src={logo} className="app-logo" alt="logo" />
                    {licenseStatus && currentStep > 0 && (
                        <Dialog>
                            <DialogTrigger disableButtonEnhancement>
                                <Text
                                    style={{
                                        position: 'absolute',
                                        right: '20px',
                                        top: '20px',
                                        fontSize: '14px',
                                        cursor: 'pointer',
                                        color: licenseStatus === 'valid' ? '#107c10' : '#d13438',
                                        textDecoration: 'underline'
                                    }}
                                >
                                    {getLicenseStatusText()}
                                </Text>
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
                <div>
                    <h1>{currentStep === 1 ? 'Creación de nueva campaña' : currentStep === 0 ? 'Inicio de sesión' : ''}</h1>
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
