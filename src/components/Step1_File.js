import React, { useState } from 'react';
import { Button, Input, Label } from '@fluentui/react-components';

function Step1_File({ onNext, initialConfig, electronAPI }) { // Accept electronAPI as a prop
  const [selectedFilePath, setSelectedFilePath] = useState(initialConfig?.excelPath || '');

  const handleFileSelect = async () => {
    if (!electronAPI) return; // Guard clause
    const filePath = await electronAPI.openFileDialog();
    if (filePath) {
      setSelectedFilePath(filePath);

      try {
        const fileContent = await electronAPI.readFileContent(filePath);
        if (fileContent) {
          const writeResult = await electronAPI.writeExcelFile(fileContent);
          if (writeResult.success) {
            console.log('Excel file replaced successfully!');
          } else {
            console.error('Failed to replace Excel file:', writeResult.error);
          }
        } else {
          console.error('Failed to read content of the selected file.');
        }
      } catch (error) {
        console.error('Error during file content handling:', error);
      }
    }
  };

  const handleDownloadTemplate = async () => {
    if (!electronAPI) return;

    try {
      // Show save dialog first
      const savePath = await electronAPI.saveFileDialog();
      if (!savePath) return; // User canceled

      // Generate the Excel template
      const templateResponse = await electronAPI.generateExcelTemplate();
      if (!templateResponse.success) {
        alert('Error al generar la plantilla: ' + templateResponse.error);
        return;
      }

      // Save the template using IPC
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
    if (selectedFilePath && electronAPI) { // Guard clause
      try {
        const response = await electronAPI.getExcelHeaders();
        if (response.success) {
          // Check if required fields are present
          if (!response.hasRequiredFields) {
            const missingFields = response.missingFields.join(', ');
            alert(`Error: El archivo Excel no contiene los campos requeridos: ${missingFields}. Por favor, asegúrese de que el archivo tenga las columnas 'item' y 'numero'.`);
            return; // Stay in Step 1
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

  return (
    <div className="step-container">
      <h2>Paso 1: Selección de Archivo</h2>
      <p>
        Asegurese que la Base este en el formato correcto.{' '}
        <span
          style={{ color: '#0078d4', cursor: 'pointer', textDecoration: 'underline' }}
          onClick={handleDownloadTemplate}
        >
          Plantilla
        </span>
      </p>
      <div className="form-group">
        <Button appearance="primary" onClick={handleFileSelect} disabled={!electronAPI}>
          Seleccionar archivo de Excel
        </Button>
      </div>
      {selectedFilePath && (
        <div className="form-group">
          <Label>Archivo Seleccionado:</Label>
          <Input value={selectedFilePath} readOnly style={{ width: '100%' }}/>
        </div>
      )}
      <div className="step-actions">
        <Button appearance="primary" onClick={handleNext} disabled={!selectedFilePath || !electronAPI}>
          Siguiente
        </Button>
      </div>
    </div>
  );
}

export default Step1_File;
