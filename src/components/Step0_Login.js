import React, { useState, useEffect } from 'react';
import { Button, Input, Label, Spinner, Text, makeStyles } from '@fluentui/react-components';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: '20px 20px 20px 20px',
        gap: '20px',
    },
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        width: '320px',
        backgroundColor: '#ffffff',
        padding: '24px',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    },
    title: {
        textAlign: 'center',
        marginBottom: '8px',
        color: '#323130',
        fontSize: '24px',
        fontWeight: '600',
    },
    subtitle: {
        textAlign: 'center',
        marginBottom: '16px',
        color: '#605e5c',
        fontSize: '14px',
    },
    error: {
        color: '#d13438',
        fontSize: '14px',
        textAlign: 'center',
        backgroundColor: '#fed7d9',
        padding: '8px',
        borderRadius: '4px',
        border: '1px solid #f3aeb3',
    },
    success: {
        color: '#107c10',
        fontSize: '14px',
        textAlign: 'center',
        backgroundColor: '#dff6dd',
        padding: '8px',
        borderRadius: '4px',
        border: '1px solid #9fd89f',
    }
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
            <div className={styles.form}>
                <Text className={styles.subtitle}>Por favor ingresa tus credenciales para acceder a la aplicación.</Text>

                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: '16px' }}>
                        <Label htmlFor="email" style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>
                            Email
                        </Label>
                        <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            disabled={loading}
                            style={{ width: '100%' }}
                        />
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <Label htmlFor="password" style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>
                            Password
                        </Label>
                        <Input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            disabled={loading}
                            style={{ width: '100%' }}
                        />
                    </div>

                    {error && <Text className={styles.error}>{error}</Text>}
                    {message && <Text className={styles.success}>{message}</Text>}

                    <Button
                        type="submit"
                        disabled={loading}
                        appearance="primary"
                        style={{
                            width: '100%',
                            marginTop: '16px',
                            padding: '12px',
                            fontSize: '16px',
                            fontWeight: '500'
                        }}
                    >
                        {loading ? <Spinner size="tiny" /> : 'Login'}
                    </Button>
                </form>
            </div>
        </div>
    );
}

export default Step0_Login;