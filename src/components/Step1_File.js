import React, { useState, useRef } from 'react';
import { Button, makeStyles, shorthands } from '@fluentui/react-components';
import {
    CheckmarkCircle20Filled,
    Warning20Filled,
    Delete20Regular,
    DocumentAdd20Regular,
    Lightbulb20Regular,
    Document20Regular
} from '@fluentui/react-icons';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('var(--spacing-xl)'),
    },
    description: {
        fontSize: 'var(--font-size-base)',
        color: 'var(--text-color-secondary)',
        marginBottom: 'var(--spacing-md)',
        lineHeight: '1.6',
    },
    dropZone: {
        ...shorthands.border('3px', 'dashed', 'rgba(76, 175, 80, 0.3)'),
        ...shorthands.borderRadius('var(--radius-lg)'),
        ...shorthands.padding('var(--spacing-2xl)'),
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all var(--transition-base)',
        backgroundColor: 'rgba(76, 175, 80, 0.02)',
        minHeight: '280px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        ...shorthands.gap('var(--spacing-lg)'),
        '&:hover': {
            ...shorthands.border('3px', 'dashed', 'var(--primary-color)'),
            backgroundColor: 'rgba(76, 175, 80, 0.05)',
            transform: 'scale(1.01)',
        },
    },
    dropZoneActive: {
        ...shorthands.border('3px', 'solid', 'var(--primary-color)'),
        backgroundColor: 'rgba(76, 175, 80, 0.1)',
        transform: 'scale(1.02)',
    },
    dropZoneIcon: {
        fontSize: '64px',
        marginBottom: 'var(--spacing-md)',
        animation: 'bounce 2s ease-in-out infinite',
    },
    dropZoneTitle: {
        fontSize: 'var(--font-size-lg)',
        fontWeight: 'var(--font-weight-semibold)',
        color: 'var(--text-color-primary)',
        marginBottom: 'var(--spacing-sm)',
    },
    dropZoneText: {
        fontSize: 'var(--font-size-sm)',
        color: 'var(--text-color-secondary)',
        marginBottom: 'var(--spacing-md)',
    },
    dropZoneFormats: {
        fontSize: 'var(--font-size-xs)',
        color: 'var(--text-color-muted)',
        fontStyle: 'italic',
    },
    filePreview: {
        ...shorthands.padding('var(--spacing-xl)'),
        ...shorthands.borderRadius('var(--radius-lg)'),
        backgroundColor: 'var(--surface-color)',
        ...shorthands.border('1px', 'solid', 'rgba(76, 175, 80, 0.2)'),
        boxShadow: 'var(--shadow-sm)',
        animation: 'fadeInUp 0.3s ease',
    },
    filePreviewHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--spacing-lg)',
        paddingBottom: 'var(--spacing-md)',
        ...shorthands.borderBottom('1px', 'solid', 'rgba(0, 0, 0, 0.06)'),
    },
    fileIcon: {
        fontSize: '48px',
        marginRight: 'var(--spacing-md)',
    },
    fileInfo: {
        flex: 1,
    },
    fileName: {
        fontSize: 'var(--font-size-lg)',
        fontWeight: 'var(--font-weight-semibold)',
        color: 'var(--text-color-primary)',
        marginBottom: 'var(--spacing-xs)',
        wordBreak: 'break-word',
    },
    filePath: {
        fontSize: 'var(--font-size-xs)',
        color: 'var(--text-color-muted)',
        fontFamily: 'monospace',
        wordBreak: 'break-all',
    },
    removeButton: {
        flexShrink: 0,
    },
    fileStats: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        ...shorthands.gap('var(--spacing-md)'),
        marginTop: 'var(--spacing-lg)',
    },
    statCard: {
        ...shorthands.padding('var(--spacing-md)'),
        ...shorthands.borderRadius('var(--radius-md)'),
        backgroundColor: 'rgba(76, 175, 80, 0.05)',
        ...shorthands.border('1px', 'solid', 'rgba(76, 175, 80, 0.1)'),
        textAlign: 'center',
    },
    statLabel: {
        fontSize: 'var(--font-size-xs)',
        color: 'var(--text-color-secondary)',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        marginBottom: 'var(--spacing-xs)',
    },
    statValue: {
        fontSize: 'var(--font-size-lg)',
        fontWeight: 'var(--font-weight-bold)',
        color: 'var(--primary-color)',
    },
    validationBadge: {
        display: 'inline-flex',
        alignItems: 'center',
        ...shorthands.gap('var(--spacing-xs)'),
        ...shorthands.padding('var(--spacing-xs)', 'var(--spacing-md)'),
        ...shorthands.borderRadius('var(--radius-sm)'),
        fontSize: 'var(--font-size-xs)',
        fontWeight: 'var(--font-weight-semibold)',
    },
    validationSuccess: {
        backgroundColor: 'rgba(40, 167, 69, 0.1)',
        color: 'var(--color-success)',
        ...shorthands.border('1px', 'solid', 'rgba(40, 167, 69, 0.2)'),
    },
    validationError: {
        backgroundColor: 'rgba(220, 53, 69, 0.1)',
        color: 'var(--color-error)',
        ...shorthands.border('1px', 'solid', 'rgba(220, 53, 69, 0.2)'),
    },
    templateSection: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        ...shorthands.padding('var(--spacing-lg)'),
        ...shorthands.borderRadius('var(--radius-md)'),
        backgroundColor: 'rgba(23, 162, 184, 0.05)',
        ...shorthands.border('1px', 'solid', 'rgba(23, 162, 184, 0.2)'),
    },
    templateInfo: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('var(--spacing-md)'),
    },
    templateIcon: {
        fontSize: '32px',
    },
    templateText: {
        flex: 1,
    },
    templateTitle: {
        fontSize: 'var(--font-size-base)',
        fontWeight: 'var(--font-weight-semibold)',
        color: 'var(--text-color-primary)',
        marginBottom: 'var(--spacing-xs)',
    },
    templateDescription: {
        fontSize: 'var(--font-size-sm)',
        color: 'var(--text-color-secondary)',
    },
});

function Step1_File({ onNext, initialConfig, electronAPI }) {
    const styles = useStyles();
    const [selectedFilePath, setSelectedFilePath] = useState(initialConfig?.excelPath || '');
    const [isDragging, setIsDragging] = useState(false);
    const [fileValidation, setFileValidation] = useState(null);
    const fileInputRef = useRef(null);

    const handleFileSelect = async () => {
        if (!electronAPI) return;
        const filePath = await electronAPI.openFileDialog();
        if (filePath) {
            await processFile(filePath);
        }
    };

    const processFile = async (filePath) => {
        setSelectedFilePath(filePath);

        try {
            const fileContent = await electronAPI.readFileContent(filePath);
            if (fileContent) {
                const writeResult = await electronAPI.writeExcelFile(fileContent);
                if (writeResult.success) {
                    console.log('Excel file replaced successfully!');
                    // Get validation info
                    const response = await electronAPI.getExcelHeaders();
                    if (response.success) {
                        setFileValidation({
                            hasRequiredFields: response.hasRequiredFields,
                            missingFields: response.missingFields || [],
                            headers: response.headers || [],
                        });
                    }
                } else {
                    console.error('Failed to replace Excel file:', writeResult.error);
                }
            }
        } catch (error) {
            console.error('Error during file content handling:', error);
        }
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                await processFile(file.path);
            } else {
                alert('Por favor, selecciona un archivo Excel (.xlsx o .xls)');
            }
        }
    };

    const handleRemoveFile = () => {
        setSelectedFilePath('');
        setFileValidation(null);
    };

    const handleDownloadTemplate = async () => {
        if (!electronAPI) return;

        try {
            const savePath = await electronAPI.saveFileDialog();
            if (!savePath) return;

            const templateResponse = await electronAPI.generateExcelTemplate();
            if (!templateResponse.success) {
                alert('Error al generar la plantilla: ' + templateResponse.error);
                return;
            }

            const saveResponse = await electronAPI.saveExcelTemplate(savePath, templateResponse.buffer);
            if (!saveResponse.success) {
                alert('Error al guardar la plantilla: ' + saveResponse.error);
                return;
            }

            alert('Plantilla guardada exitosamente en: ' + savePath);
        } catch (error) {
            console.error('Error downloading template:', error);
            alert('Error al guardar la plantilla: ' + error.message);
        }
    };

    const handleNext = async () => {
        if (selectedFilePath && electronAPI) {
            try {
                const response = await electronAPI.getExcelHeaders();
                if (response.success) {
                    if (!response.hasRequiredFields) {
                        const missingFields = response.missingFields.join(', ');
                        alert(`Error: El archivo Excel no contiene los campos requeridos: ${missingFields}. Por favor, asegúrese de que el archivo tenga las columnas 'item' y 'numero'.`);
                        return;
                    }
                    onNext({ excelPath: response.path, excelHeaders: response.headers });
                } else {
                    console.error('Failed to get Excel headers:', response.error);
                    onNext({ excelPath: 'excel/plantilla-wm.xlsx', excelHeaders: [] });
                }
            } catch (error) {
                console.error('Error calling getExcelHeaders IPC:', error);
                onNext({ excelPath: 'excel/plantilla-wm.xlsx', excelHeaders: [] });
            }
        }
    };

    const getFileName = () => {
        if (!selectedFilePath) return '';
        const lastSlashIndex = Math.max(selectedFilePath.lastIndexOf('/'), selectedFilePath.lastIndexOf('\\'));
        return selectedFilePath.substring(lastSlashIndex + 1);
    };

    return (
        <div className="step-container">
            <h2>Paso 1: Selección de Archivo</h2>
            <p className={styles.description}>
                Sube tu archivo Excel con los contactos para la campaña. Asegúrate de que contenga las columnas requeridas: <strong>item</strong> y <strong>numero</strong>.
            </p>

            {!selectedFilePath ? (
                <>
                    {/* Drop Zone */}
                    <div
                        className={`${styles.dropZone} ${isDragging ? styles.dropZoneActive : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={handleFileSelect}
                >
                    <div className={styles.dropZoneIcon}>
                        <DocumentAdd20Regular style={{ fontSize: '32px' }} />
                    </div>
                        <div className={styles.dropZoneTitle}>Arrastra tu archivo aquí</div>
                        <div className={styles.dropZoneText}>o haz clic para seleccionar</div>
                        <Button appearance="primary" size="large">
                            Seleccionar Archivo Excel
                        </Button>
                        <div className={styles.dropZoneFormats}>
                            Formatos soportados: .xlsx, .xls
                        </div>
                    </div>

                    {/* Template Section */}
                    <div className={styles.templateSection}>
                        <div className={styles.templateInfo}>
                            <div className={styles.templateIcon}>
                                <Lightbulb20Regular style={{ fontSize: '24px' }} />
                            </div>
                            <div className={styles.templateText}>
                                <div className={styles.templateTitle}>¿No tienes una plantilla?</div>
                                <div className={styles.templateDescription}>
                                    Descarga nuestra plantilla de ejemplo con el formato correcto
                                </div>
                            </div>
                        </div>
                        <Button appearance="outline" onClick={handleDownloadTemplate}>
                            Descargar Plantilla
                        </Button>
                    </div>
                </>
            ) : (
                <>
                    {/* File Preview */}
                        <div className={styles.filePreview}>
                            <div className={styles.filePreviewHeader}>
                                <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                    <div className={styles.fileIcon}>
                                        <Document20Regular style={{ fontSize: '24px' }} />
                                    </div>
                                <div className={styles.fileInfo}>
                                    <div className={styles.fileName}>{getFileName()}</div>
                                    <div className={styles.filePath}>{selectedFilePath}</div>
                                </div>
                            </div>
                            <Button
                                appearance="subtle"
                                onClick={handleRemoveFile}
                                className={styles.removeButton}
                                icon={<Delete20Regular />}
                            >
                                Eliminar
                            </Button>
                        </div>

                        {fileValidation && (
                            <>
                                {/* Validation Badge */}
                                <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                                    {fileValidation.hasRequiredFields ? (
                                        <span className={`${styles.validationBadge} ${styles.validationSuccess}`}>
                                            <CheckmarkCircle20Filled style={{ marginRight: '6px' }} />
                                            Campos requeridos encontrados
                                        </span>
                                    ) : (
                                        <span className={`${styles.validationBadge} ${styles.validationError}`}>
                                            <Warning20Filled style={{ marginRight: '6px' }} />
                                            Faltan campos: {fileValidation.missingFields.join(', ')}
                                        </span>
                                    )}
                                </div>

                                {/* File Stats */}
                                {fileValidation.headers && fileValidation.headers.length > 0 && (
                                    <div className={styles.fileStats}>
                                        <div className={styles.statCard}>
                                            <div className={styles.statLabel}>Columnas</div>
                                            <div className={styles.statValue}>{fileValidation.headers.length}</div>
                                        </div>
                                        <div className={styles.statCard}>
                                            <div className={styles.statLabel}>Estado</div>
                                            <div className={styles.statValue}>
                                                {fileValidation.hasRequiredFields ? '✓' : '✗'}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Change File Button */}
                    <Button appearance="outline" onClick={handleFileSelect}>
                        Cambiar Archivo
                    </Button>
                </>
            )}

            {/* Actions */}
            <div className="step-actions">
                <Button
                    appearance="primary"
                    size="large"
                    onClick={handleNext}
                    disabled={!selectedFilePath || !electronAPI || (fileValidation && !fileValidation.hasRequiredFields)}
                >
                    Siguiente →
                </Button>
            </div>

            {/* Animations */}
            <style>{`
                @keyframes bounce {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-10px); }
                }
            `}</style>
        </div>
    );
}

export default Step1_File;
