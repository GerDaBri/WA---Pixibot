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

  const handleNext = async () => {
    if (selectedFilePath && electronAPI) { // Guard clause
      try {
        const response = await electronAPI.getExcelHeaders();
        if (response.success) {
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
