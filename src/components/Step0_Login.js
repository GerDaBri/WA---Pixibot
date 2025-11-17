import React, { useState, useEffect } from 'react';
import { Button, Input, Label, Spinner, Text, makeStyles, shorthands } from '@fluentui/react-components';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100%',
        ...shorthands.padding('var(--spacing-2xl)'),
        position: 'relative',
    },
    welcomeSection: {
        textAlign: 'center',
        marginBottom: 'var(--spacing-2xl)',
        animation: 'fadeIn 0.6s ease',
    },
    welcomeIcon: {
        width: '120px',
        height: '120px',
        marginBottom: 'var(--spacing-lg)',
        animation: 'float 3s ease-in-out infinite',
        objectFit: 'contain',
    },
    welcomeTitle: {
        fontSize: 'var(--font-size-2xl)',
        fontWeight: 'var(--font-weight-bold)',
        color: 'var(--text-color-primary)',
        marginBottom: 'var(--spacing-sm)',
        lineHeight: '1.2',
    },
    welcomeSubtitle: {
        fontSize: 'var(--font-size-base)',
        color: 'var(--text-color-secondary)',
        fontWeight: 'var(--font-weight-regular)',
    },
    formCard: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('var(--spacing-lg)'),
        width: '100%',
        maxWidth: '420px',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(10px)',
        ...shorthands.padding('var(--spacing-2xl)'),
        ...shorthands.borderRadius('var(--radius-xl)'),
        boxShadow: 'var(--shadow-xl)',
        ...shorthands.border('1px', 'solid', 'rgba(255, 255, 255, 0.3)'),
        animation: 'slideUp 0.5s ease',
    },
    inputGroup: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('var(--spacing-sm)'),
    },
    inputLabel: {
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--font-weight-semibold)',
        color: 'var(--text-color-primary)',
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('var(--spacing-xs)'),
    },
    inputIcon: {
        fontSize: 'var(--font-size-base)',
    },
    input: {
        width: '100%',
        fontSize: 'var(--font-size-base)',
        ...shorthands.padding('var(--spacing-md)'),
        ...shorthands.borderRadius('var(--radius-md)'),
        ...shorthands.border('2px', 'solid', 'rgba(0, 0, 0, 0.1)'),
        transition: 'all var(--transition-fast)',
        '&:focus': {
            ...shorthands.border('2px', 'solid', 'var(--primary-color)'),
            boxShadow: '0 0 0 4px rgba(76, 175, 80, 0.1)',
        },
    },
    submitButton: {
        width: '100%',
        marginTop: 'var(--spacing-md)',
        ...shorthands.padding('var(--spacing-lg)'),
        fontSize: 'var(--font-size-base)',
        fontWeight: 'var(--font-weight-semibold)',
        background: 'var(--primary-gradient)',
        ...shorthands.borderRadius('var(--radius-md)'),
        ...shorthands.border('none'),
        color: 'white',
        cursor: 'pointer',
        transition: 'all var(--transition-base)',
        boxShadow: 'var(--shadow-md)',
        '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: 'var(--shadow-lg)',
        },
        '&:active': {
            transform: 'translateY(0)',
        },
        '&:disabled': {
            opacity: 0.6,
            cursor: 'not-allowed',
            transform: 'none',
        },
    },
    error: {
        color: 'var(--color-error)',
        fontSize: 'var(--font-size-sm)',
        textAlign: 'center',
        ...shorthands.padding('var(--spacing-md)'),
        ...shorthands.borderRadius('var(--radius-md)'),
        backgroundColor: 'rgba(220, 53, 69, 0.1)',
        ...shorthands.border('1px', 'solid', 'rgba(220, 53, 69, 0.2)'),
        animation: 'shake 0.5s ease',
    },
    success: {
        color: 'var(--color-success)',
        fontSize: 'var(--font-size-sm)',
        textAlign: 'center',
        ...shorthands.padding('var(--spacing-md)'),
        ...shorthands.borderRadius('var(--radius-md)'),
        backgroundColor: 'rgba(40, 167, 69, 0.1)',
        ...shorthands.border('1px', 'solid', 'rgba(40, 167, 69, 0.2)'),
    },
});

function Step0_Login({ onLoginSuccess }) {
    const styles = useStyles();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        console.log('Step0_Login: Component mounted, inputs should be responsive');
        return () => {
            console.log('Step0_Login: Component unmounting');
        };
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        console.log('Step0_Login: Starting login process, setting loading to true');
        console.log('Step0_Login: Login attempt started');
        setLoading(true);
        setError('');
        setMessage('');

        try {
            if (!window.electronAPI) {
                throw new Error('Electron API not available');
            }
            const loginStart = Date.now();
            const result = await window.electronAPI.loginUser(email, password);
            const loginEnd = Date.now();
            console.log(`Step0_Login: Login completed in ${loginEnd - loginStart}ms, result:`, result);
            if (result.success) {
                console.log('Step0_Login: Login successful');
            } else {
                console.log('Step0_Login: Login failed:', result.error);
            }

            if (result.success) {
                setMessage('Login successful!');
                onLoginSuccess(result);
            } else {
                // Handle specific error reasons
                if (result.reason === 'suspended') {
                    setError('Licencia suspendida - Contacte al administrador');
                } else if (result.reason === 'expired') {
                    setError('Licencia expirada - Contacte al administrador');
                } else if (result.reason === 'no_license_data') {
                    setError('Licencia no encontrada - Verifique sus credenciales');
                } else if (result.reason === 'invalid_status') {
                    setError('Licencia inválida - Contacte al administrador');
                } else {
                    setError(result.error || 'Login failed');
                }
            }
        } catch (err) {
            console.error('Step0_Login: Login error:', err);
            setError('Connection failed. Please check your internet connection.');
        } finally {
            console.log('Step0_Login: Setting loading to false, inputs should be responsive again');
            setLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            {/* Welcome Section */}
            <div className={styles.welcomeSection}>
                <img src="../assets/logos/logo-principal.png" alt="Pixibot Logo" className={styles.welcomeIcon} />
                <h1 className={styles.welcomeTitle}>Bienvenido a Pixibot</h1>
                <p className={styles.welcomeSubtitle}>Plataforma de Mensajería WhatsApp Profesional</p>
            </div>

            {/* Login Card */}
            <div className={styles.formCard}>
                <form onSubmit={handleSubmit}>
                    {/* Email Input */}
                    <div className={styles.inputGroup}>
                        <label htmlFor="email" className={styles.inputLabel}>
                            <span className={styles.inputIcon}>📧</span>
                            <span>Correo Electrónico</span>
                        </label>
                        <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            disabled={loading}
                            placeholder="tu@email.com"
                            className={styles.input}
                        />
                    </div>

                    {/* Password Input */}
                    <div className={styles.inputGroup}>
                        <label htmlFor="password" className={styles.inputLabel}>
                            <span className={styles.inputIcon}>🔒</span>
                            <span>Contraseña</span>
                        </label>
                        <Input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            disabled={loading}
                            placeholder="••••••••"
                            className={styles.input}
                        />
                    </div>

                    {/* Error/Success Messages */}
                    {error && <div className={styles.error}>⚠️ {error}</div>}
                    {message && <div className={styles.success}>✅ {message}</div>}

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={loading}
                        className={styles.submitButton}
                    >
                        {loading ? (
                            <>
                                <Spinner size="tiny" style={{ marginRight: '8px' }} />
                                Iniciando sesión...
                            </>
                        ) : (
                            <>
                                Iniciar Sesión →
                            </>
                        )}
                    </button>
                </form>
            </div>

            {/* Animations CSS */}
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @keyframes slideUp {
                    from {
                        opacity: 0;
                        transform: translateY(30px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }

                @keyframes float {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-10px); }
                }

                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-5px); }
                    75% { transform: translateX(5px); }
                }
            `}</style>
        </div>
    );
}

export default Step0_Login;