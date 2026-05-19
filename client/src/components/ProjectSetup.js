import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const ProjectSetup = () => {
  const [projectTitle, setProjectTitle] = useState('');
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [validation, setValidation] = useState({
    format: null,   // null = pending, true = pass, false = fail
    headers: null,
    cols: null,
    missing: null
  });
  
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // Simple RFC 4180 compliant CSV parser
  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    return lines.map(line => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current);
      return result.map(cell => cell.trim().replace(/^"|"$/g, ''));
    });
  };

  // Client-side CSV validator
  const validateCSVData = (text, fileName) => {
    const formatPass = fileName.toLowerCase().endsWith('.csv');
    const parsed = parseCSV(text);
    
    if (parsed.length === 0 || parsed[0].length === 0) {
      setValidation({
        format: formatPass,
        headers: false,
        cols: false,
        missing: false
      });
      return;
    }
    
    let headers = [...parsed[0]];
    
    // Headers Check: non-empty, unique, valid strings
    const uniqueHeaders = new Set(headers);
    const headersPass = headers.length > 0 && 
                        headers.every(h => h !== '') && 
                        uniqueHeaders.size === headers.length;
                        
    // Ensure we have at least two columns in the dataset to act as outcome and intervention
    const colsPass = headers.length >= 2;
    
    // Missing Values Check: scan all rows except headers
    let missingPass = true;
    for (let r = 1; r < parsed.length; r++) {
      const row = parsed[r];
      if (row.length < headers.length) {
        missingPass = false;
        break;
      }
      if (row.some(cell => cell === '' || cell.toLowerCase() === 'na' || cell.toLowerCase() === 'null' || cell.toLowerCase() === 'nan')) {
        missingPass = false;
        break;
      }
    }
    
    setValidation({
      format: formatPass,
      headers: headersPass,
      cols: colsPass,
      missing: missingPass
    });
    
    if (!formatPass) {
      setMessage('Dataset file format check failed. File must be in CSV format.');
    } else if (!headersPass) {
      setMessage('Dataset column headers check failed. All columns must have clear, unique names.');
    } else if (!colsPass) {
      setMessage('Dataset must contain at least two columns to act as outcome and intervention.');
    } else if (!missingPass) {
      setMessage('Dataset contains missing values or incomplete rows.');
    } else {
      setMessage('Dataset verified successfully! All criteria passed.');
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setMessage('');
    
    // Automatically pre-fill the project title based on the filename if empty
    if (!projectTitle.trim()) {
      const cleanName = selectedFile.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ").replace(/-/g, " ");
      const capitalized = cleanName.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      setProjectTitle(capitalized);
    }
    
    const reader = new FileReader();
    reader.onload = (event) => {
      validateCSVData(event.target.result, selectedFile.name);
    };
    reader.readAsText(selectedFile);
  };

  // Automated CSV repair and imputation
  const handleFixFile = () => {
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const parsed = parseCSV(text);
      
      if (parsed.length === 0) return;
      
      let headers = [...parsed[0]];
      
      // 1. Fix Headers: unique, non-empty, alphanumeric-friendly
      const cleanedHeaders = [];
      const headerCounts = {};
      for (let i = 0; i < headers.length; i++) {
        let h = headers[i].trim();
        if (h === '') {
          h = `Column_${i + 1}`;
        }
        h = h.replace(/[^a-zA-Z0-9_/]/g, '_'); // Allow slash
        
        if (cleanedHeaders.includes(h)) {
          headerCounts[h] = (headerCounts[h] || 1) + 1;
          h = `${h}_dup${headerCounts[h]}`;
        }
        cleanedHeaders.push(h);
      }
      headers = cleanedHeaders;
      

      // 3. Fix Missing Values & Impute
      const rows = parsed.slice(1);
      const numCols = headers.length;
      const colImputers = [];
      
      for (let c = 0; c < numCols; c++) {
        const values = [];
        let isNumeric = true;
        let numericCount = 0;
        let totalCount = 0;
        
        for (let r = 0; r < rows.length; r++) {
          if (rows[r] && rows[r].length > c) {
            const val = rows[r][c];
            if (val !== '' && val.toLowerCase() !== 'na' && val.toLowerCase() !== 'null' && val.toLowerCase() !== 'nan') {
              values.push(val);
              totalCount++;
              const parsedNum = parseFloat(val);
              if (!isNaN(parsedNum)) {
                numericCount++;
              }
            }
          }
        }
        
        if (totalCount > 0 && numericCount / totalCount < 0.7) {
          isNumeric = false;
        }
        
        if (totalCount === 0) {
          colImputers.push({ isNumeric: true, val: 0.0 });
        } else if (isNumeric) {
          const sum = values.reduce((acc, v) => acc + parseFloat(v), 0);
          const mean = sum / totalCount;
          colImputers.push({ isNumeric: true, val: Number(mean.toFixed(4)) });
        } else {
          const frequencies = {};
          let maxFreq = 0;
          let mode = values[0];
          for (const val of values) {
            frequencies[val] = (frequencies[val] || 0) + 1;
            if (frequencies[val] > maxFreq) {
              maxFreq = frequencies[val];
              mode = val;
            }
          }
          colImputers.push({ isNumeric: false, val: mode });
        }
      }
      
      const imputedRows = [];
      for (let r = 0; r < rows.length; r++) {
        const row = [...(rows[r] || [])];
        while (row.length < numCols) {
          row.push('');
        }
        
        const imputedRow = row.map((cell, c) => {
          if (cell === '' || cell.toLowerCase() === 'na' || cell.toLowerCase() === 'null' || cell.toLowerCase() === 'nan') {
            return String(colImputers[c].val);
          }
          return cell;
        });
        imputedRows.push(imputedRow);
      }
      
      // Convert back to CSV text
      const csvContent = [
        headers.join(','),
        ...imputedRows.map(row => {
          return row.map(cell => {
            if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
              return `"${cell.replace(/"/g, '""')}"`;
            }
            return cell;
          }).join(',');
        })
      ].join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const fixedFile = new File([blob], file.name, { type: 'text/csv' });
      
      setFile(fixedFile);
      validateCSVData(csvContent, file.name);
      setMessage('Dataset automatically repaired! Missing values imputed and required columns aligned.');
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    
    if (!projectTitle.trim()) {
      setMessage('Please enter a project title');
      return;
    }
    
    if (!file) {
      setMessage('Please select a dataset file');
      return;
    }

    setLoading(true);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_title', projectTitle);

    try {
      const response = await fetch('/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        sessionStorage.setItem('datasetInfo', JSON.stringify(data));
        navigate('/config');
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch (error) {
      setMessage(`Upload failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadPreset = async () => {
    const title = projectTitle.trim() || 'Synthetic Validation Project';
    setLoading(true);
    setMessage('');
    
    try {
      const response = await fetch('/upload-preset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ project_title: title }),
      });

      const data = await response.json();

      if (response.ok) {
        sessionStorage.setItem('datasetInfo', JSON.stringify(data));
        navigate('/config');
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch (error) {
      setMessage(`Failed to load synthetic dataset: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const renderCheckIcon = (state) => {
    if (state === null) return <span className="requirement-icon pending"></span>;
    if (state === true) return <span className="requirement-icon pass">✓</span>;
    return <span className="requirement-icon fail">✗</span>;
  };

  const allChecksPass = 
    validation.format === true && 
    validation.headers === true && 
    validation.cols === true && 
    validation.missing === true;
  const anyCheckFails = validation.format === false || validation.headers === false || validation.cols === false || validation.missing === false;

  return (
    <div className="project-setup">
      {/* Left panel - Branding and File Selector */}
      <div className="left-panel">
        <div className="brand-header">
          <h1 className="brand-title">Virtual Twins Validation Platform</h1>
          <p className="brand-subtitle">Thesis Implementation - Data Analysis & Validation</p>
        </div>

        {/* Center Glass Box (Upload CSV File Trigger) */}
        <div className="upload-glass-box" onClick={() => fileInputRef.current.click()}>
          <div className="upload-icon-container">
            <svg className="upload-icon-svg" viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
          </div>
          <span className="upload-text">
            {file ? file.name : 'Upload a csv File'}
          </span>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".csv"
            style={{ display: 'none' }}
          />
        </div>

        {/* Requirements glass box */}
        <div className="requirements-panel">
          <h3 className="requirements-title">Requirements</h3>
          <ul className="requirements-list">
            <li className="requirement-item">
              {renderCheckIcon(validation.format)}
              <span className="requirement-text">Dataset should be in CSV format</span>
            </li>
            <li className="requirement-item">
              {renderCheckIcon(validation.headers)}
              <span className="requirement-text">Include clear column headers</span>
            </li>
            <li className="requirement-item">
              {renderCheckIcon(validation.cols)}
              <span className="requirement-text">Ensure outcome and intervention columns are present</span>
            </li>
            <li className="requirement-item">
              {renderCheckIcon(validation.missing)}
              <span className="requirement-text">Missing values should be handled appropriately</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Right panel - Input and actions */}
      <div className="right-panel">
        <div className="setup-right-container">
          <h2 className="right-title">Project Setup</h2>
          <p className="right-description">
            Start your Virtual Twins analysis by setting up your project and uploading your dataset.
          </p>

          <div className="setup-form">
            <div className="form-group-setup">
              <label htmlFor="projectTitle" className="form-label-setup">Project title</label>
              <input
                type="text"
                id="projectTitle"
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                placeholder="Enter your project title..."
                className="form-input-setup"
                required
              />
            </div>

            {/* Validation toast messages */}
            {message && (
              <div className={`validation-toast ${
                message.includes('repaired') || message.includes('successfully') ? 'success' : 
                message.includes('failed') || message.includes('Error') ? 'error' : 'info'
              }`}>
                {message}
              </div>
            )}

            <div className="setup-actions-container">
              {/* Fix File button appears on failure */}
              {anyCheckFails && (
                <button
                  type="button"
                  onClick={handleFixFile}
                  className="btn-fix-setup"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                  </svg>
                  Fix File
                </button>
              )}

              <div className="buttons-row">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading || !allChecksPass || !projectTitle.trim()}
                  className="btn-upload-setup"
                >
                  {loading ? 'Uploading...' : 'Upload Dataset'}
                </button>
                <button
                  type="button"
                  onClick={handleLoadPreset}
                  disabled={loading}
                  className="btn-preset-setup"
                >
                  Use Synthetic Dataset
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Decorative golden sparkle in bottom right */}
        <svg className="sparkle-icon" viewBox="0 0 24 24" fill="none" stroke="#f1c40f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v20M2 12h20M12 2l3 10 7 3-7 3-3 10-3-10-7-3 7-3 3-10z" />
        </svg>
      </div>
    </div>
  );
};

export default ProjectSetup;