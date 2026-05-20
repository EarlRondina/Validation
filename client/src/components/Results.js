import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const Results = () => {
  const [attempts, setAttempts] = useState([]);
  const [selectedAttemptIdx, setSelectedAttemptIdx] = useState(0);
  const [selectedMethod, setSelectedMethod] = useState('double');
  
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState([]);
  const logsEndRef = useRef(null);
  
  const [error, setError] = useState('');
  const [analysisConfig, setAnalysisConfig] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedShapModel, setSelectedShapModel] = useState('rf');
  const [fullscreenPlot, setFullscreenPlot] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const config = sessionStorage.getItem('analysisConfig');
    const datasetInfo = sessionStorage.getItem('datasetInfo');
    
    if (!config || !datasetInfo) {
      navigate('/');
      return;
    }

    setAnalysisConfig(JSON.parse(config));
    // Only run analysis if we haven't already started
    if (loadingMessages.length === 0) {
      runAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  useEffect(() => {
    // Auto-scroll loading logs to bottom
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [loadingMessages]);

  const runAnalysis = async () => {
    try {
      const response = await fetch('/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(`Analysis failed: ${data.error || response.statusText}`);
        setLoading(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let partialLine = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = (partialLine + chunk).split('\n');
          partialLine = lines.pop(); // Keep incomplete line

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.type === 'status') {
                setLoadingMessages(prev => [...prev, data.message]);
              } else if (data.type === 'complete') {
                setAttempts(data.attempts);
                setSelectedAttemptIdx(data.best_idx);
                setLoading(false);
              } else if (data.type === 'error') {
                setError(`Analysis failed: ${data.message}`);
                setLoading(false);
              }
            } catch (e) {
              console.error("Error parsing JSON stream:", e, line);
            }
          }
        }
      }
    } catch (error) {
      setError(`Network error: ${error.message}`);
      setLoading(false);
    }
  };

  const getR2Interpretation = (r2) => {
    if (r2 >= 0.8) return { level: 'excellent', text: 'Excellent fit' };
    if (r2 >= 0.6) return { level: 'good', text: 'Good fit' };
    if (r2 >= 0.4) return { level: 'moderate', text: 'Moderate fit' };
    if (r2 >= 0.2) return { level: 'weak', text: 'Weak fit' };
    return { level: 'poor', text: 'Poor fit' };
  };

  const downloadResults = () => {
    const datasetInfo = JSON.parse(sessionStorage.getItem('datasetInfo'));
    const reportData = {
      project_title: datasetInfo.project_title,
      dataset: datasetInfo.filename,
      analysis_config: analysisConfig,
      results: attempts[selectedAttemptIdx],
      all_attempts: attempts,
      timestamp: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], {
      type: 'application/json',
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vt_analysis_results_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="results loading-state">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <h2>Running Virtual Twins Analysis...</h2>
          <p>Please wait while we process your data and validate the model axioms.</p>
          
          <div className="loading-logs" style={{ 
            marginTop: '25px', 
            textAlign: 'left', 
            background: '#ffffff', 
            padding: '20px', 
            borderRadius: '12px', 
            border: '1px solid #e2e8f0', 
            boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.02)',
            maxHeight: '220px', 
            overflowY: 'auto' 
          }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Analysis Progress</h4>
            {loadingMessages.map((msg, i) => (
              <div key={i} style={{ 
                fontSize: '14px', 
                color: '#475569', 
                marginBottom: '10px', 
                borderBottom: '1px solid #f8fafc', 
                paddingBottom: '8px',
                display: 'flex',
                alignItems: 'flex-start'
              }}>
                <span style={{ color: '#6366f1', fontWeight: 'bold', marginRight: '12px', minWidth: '85px' }}>
                  [{new Date().toLocaleTimeString()}]
                </span>
                <span style={{ 
                  fontWeight: msg.includes('Desired outcome achieved') ? 'bold' : 'normal',
                  color: msg.includes('Desired outcome achieved') ? '#10b981' : (msg.includes('Low performance') ? '#ef4444' : '#475569') 
                }}>
                  {msg}
                </span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="results error-state">
        <div className="error-container">
          <h2>Analysis Error</h2>
          <p className="error-message">{error}</p>
          <button onClick={() => navigate('/')} className="btn btn-primary">
            Start Over
          </button>
        </div>
      </div>
    );
  }

  const results = attempts[selectedAttemptIdx];
  if (!results) return null;

  const currentMethodResults = results.methods[selectedMethod];

  const handleBackToConfig = () => {
    const confirmBack = window.confirm("Are you sure you want to return to the dataset configuration tab? Your current analysis results will be lost.");
    if (confirmBack) {
      navigate('/config');
    }
  };

  const getActiveShapData = () => {
    const viz = currentMethodResults?.visualizations;
    if (!viz) return null;
    
    if (selectedShapModel === 'rf' && viz.shap_rf) return viz.shap_rf;
    if (selectedShapModel === 'regression' && viz.shap_regression_tree) return viz.shap_regression_tree;
    if (selectedShapModel === 'classification' && viz.shap_classification_tree) return viz.shap_classification_tree;
    
    // Fallback for older formats
    if (selectedShapModel === 'regression' && viz.shap_summary) {
      return {
        shap_summary: viz.shap_summary,
        shap_dependence: viz.shap_dependence,
        top_features: viz.top_features
      };
    }
    return null;
  };

  const shapData = getActiveShapData();

  const getShapDescription = () => {
    if (selectedShapModel === 'rf') {
      return "This explains the primary predictive Random Forest model. It highlights how patient covariates, in conjunction with their treatment assignment (Intervention_encoded), influence the predicted target outcome.";
    } else if (selectedShapModel === 'regression') {
      return "This explains the ITE Regression Decision Tree model. It demonstrates which patient characteristics are key in explaining and predicting the continuous Individual Treatment Effect (ITE).";
    } else {
      return "This explains the binary Treatment Recommendation Tree. It shows which characteristics most strongly dictate the clinical recommendation (whether a patient falls above or below the median treatment effect).";
    }
  };
  return (
    <div className="results">
      <div className="results-container">
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
          <h2 style={{ margin: 0, textAlign: 'left' }}>Virtual Twins Analysis Results</h2>
          
          {attempts.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#f8fafc', padding: '8px 16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '14px', color: '#475569', fontWeight: '600' }}>Select Attempt:</span>
              <select 
                value={selectedAttemptIdx} 
                onChange={(e) => setSelectedAttemptIdx(Number(e.target.value))}
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: 'white',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#1e293b',
                  cursor: 'pointer',
                  outline: 'none',
                  minWidth: '220px'
                }}
              >
                {attempts.map((attempt, idx) => (
                  <option key={idx} value={idx}>
                    Attempt {attempt.attempt_id} {attempt.methods?.double?.axioms?.["Axiom 1: Consistency"] ? '(Metrics Met ✓)' : '(Low Performance ✗)'}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* METHOD TOGGLE */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '25px', padding: '4px', background: '#f1f5f9', borderRadius: '12px', width: 'fit-content' }}>
          {['simple', 'double', 'kfold'].map(method => (
            <button
              key={method}
              onClick={() => setSelectedMethod(method)}
              style={{
                padding: '8px 20px',
                borderRadius: '8px',
                border: 'none',
                background: selectedMethod === method ? '#ffffff' : 'transparent',
                boxShadow: selectedMethod === method ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                color: selectedMethod === method ? '#4f46e5' : '#64748b',
                fontWeight: selectedMethod === method ? '700' : '500',
                fontSize: '14px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                textTransform: 'capitalize'
              }}
            >
              {method === 'kfold' ? 'K-Fold' : method} Method
            </button>
          ))}
        </div>
        
        {/* TABS NAVIGATION */}
        <div className="results-tabs" style={{ 
          display: 'flex', 
          borderBottom: '2px solid #f1f5f9', 
          marginBottom: '25px', 
          gap: '15px',
          width: '100%',
          flexWrap: 'wrap'
        }}>
          <button
            onClick={() => setActiveTab('overview')}
            className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            style={{
              padding: '12px 16px',
              fontSize: '15px',
              fontWeight: '600',
              border: 'none',
              background: 'none',
              borderBottom: activeTab === 'overview' ? '3px solid #6366f1' : '3px solid transparent',
              color: activeTab === 'overview' ? '#4f46e5' : '#64748b',
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out'
            }}
          >
            Model Overview
          </button>
          <button
            onClick={() => setActiveTab('causal')}
            className={`tab-btn ${activeTab === 'causal' ? 'active' : ''}`}
            id="tab-causal-validation"
            style={{
              padding: '12px 16px',
              fontSize: '15px',
              fontWeight: '600',
              border: 'none',
              background: 'none',
              borderBottom: activeTab === 'causal' ? '3px solid #6366f1' : '3px solid transparent',
              color: activeTab === 'causal' ? '#4f46e5' : '#64748b',
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out'
            }}
          >
            Causal Validation
          </button>
          <button
            onClick={() => setActiveTab('classification_tree')}
            className={`tab-btn ${activeTab === 'classification_tree' ? 'active' : ''}`}
            style={{
              padding: '12px 16px',
              fontSize: '15px',
              fontWeight: '600',
              border: 'none',
              background: 'none',
              borderBottom: activeTab === 'classification_tree' ? '3px solid #6366f1' : '3px solid transparent',
              color: activeTab === 'classification_tree' ? '#4f46e5' : '#64748b',
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out'
            }}
          >
            Classification Tree
          </button>
          <button
            onClick={() => setActiveTab('decision_tree')}
            className={`tab-btn ${activeTab === 'decision_tree' ? 'active' : ''}`}
            style={{
              padding: '12px 16px',
              fontSize: '15px',
              fontWeight: '600',
              border: 'none',
              background: 'none',
              borderBottom: activeTab === 'decision_tree' ? '3px solid #6366f1' : '3px solid transparent',
              color: activeTab === 'decision_tree' ? '#4f46e5' : '#64748b',
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out'
            }}
          >
            Regression Tree
          </button>
          <button
            onClick={() => setActiveTab('shap')}
            className={`tab-btn ${activeTab === 'shap' ? 'active' : ''}`}
            style={{
              padding: '12px 16px',
              fontSize: '15px',
              fontWeight: '600',
              border: 'none',
              background: 'none',
              borderBottom: activeTab === 'shap' ? '3px solid #6366f1' : '3px solid transparent',
              color: activeTab === 'shap' ? '#4f46e5' : '#64748b',
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out'
            }}
          >
            SHAP Results
          </button>
        </div>

        {activeTab === 'overview' ? (
          <>
            <div className="results-summary" style={{ marginBottom: '30px' }}>
              <h3 style={{ color: '#2c3e50', fontSize: '1.25rem', marginBottom: '20px', textAlign: 'left' }}>
                Causal Performance & Validation Metrics
              </h3>
              <div className="summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
                <div className="summary-card" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', boxShadow: 'none', padding: '24px', borderRadius: '12px' }}>
                  <h3 style={{ fontSize: '13px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px 0', fontWeight: '600' }}>
                    Recommendation Accuracy
                  </h3>
                  <div style={{ fontSize: '2.5rem', fontWeight: '800', color: '#6366f1', margin: '0 0 8px 0', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
                    {currentMethodResults.accuracy?.value != null ? (currentMethodResults.accuracy.value * 100).toFixed(2) + '%' : 'N/A'}
                  </div>
                  <span style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.4', display: 'block' }}>
                    Measures correct classification of treatment responders vs. non-responders.
                  </span>
                </div>
                
                <div className="summary-card" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', boxShadow: 'none', padding: '24px', borderRadius: '12px' }}>
                  <h3 style={{ fontSize: '13px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px 0', fontWeight: '600' }}>
                    Qini Uplift Score
                  </h3>
                  <div style={{ fontSize: '2.5rem', fontWeight: '800', color: '#0ea5e9', margin: '0 0 8px 0', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
                    {currentMethodResults.qini_score != null ? currentMethodResults.qini_score.toFixed(4) : 'N/A'}
                  </div>
                  <span style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.4', display: 'block' }}>
                    Measures the model's ability to prioritize patients for maximum treatment uplift.
                  </span>
                </div>
                
                <div className="summary-card" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', boxShadow: 'none', padding: '24px', borderRadius: '12px' }}>
                  <h3 style={{ fontSize: '13px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px 0', fontWeight: '600' }}>
                    Validation Slope (β₁)
                  </h3>
                  <div style={{ fontSize: '2.5rem', fontWeight: '800', color: '#10b981', margin: '0 0 8px 0', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
                    {currentMethodResults.regression?.slope != null ? currentMethodResults.regression.slope.toFixed(4) : 'N/A'}
                  </div>
                  <span style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.4', display: 'block' }}>
                    Indicates calibration of predicted Individual Treatment Effects (ITE) against pseudo-observed effects.
                  </span>
                </div>
              </div>
            </div>

            <div className="analysis-details" style={{ marginTop: '30px' }}>
              <h3 style={{ color: '#2c3e50', fontSize: '1.25rem', marginBottom: '20px', textAlign: 'left' }}>
                Dataset & Configuration Overview
              </h3>
              <div className="details-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', background: 'transparent', padding: 0 }}>
                <div style={{ background: '#f8fafc', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'left' }}>
                  <h4 style={{ margin: '0 0 16px 0', fontSize: '15px', color: '#1e293b', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', fontWeight: '600' }}>
                    Dataset Characteristics
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', alignItems: 'center' }}>
                      <span style={{ color: '#64748b', fontWeight: '500' }}>Initial Sample Size:</span>
                      <span style={{ color: '#1e293b', fontWeight: '700' }}>{results.sample_size?.toLocaleString()} patients</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', alignItems: 'center' }}>
                      <span style={{ color: '#64748b', fontWeight: '500' }}>Trimmed Sample Size:</span>
                      <span style={{ color: '#1e293b', fontWeight: '700' }}>{results.trimmed_size?.toLocaleString()} patients</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', alignItems: 'center' }}>
                      <span style={{ color: '#64748b', fontWeight: '500' }}>Trimmed Outliers:</span>
                      <span style={{ color: '#e11d48', fontWeight: '700' }}>{results.trimmed_count} patients</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', alignItems: 'center' }}>
                      <span style={{ color: '#64748b', fontWeight: '500' }}>Number of Feature Covariates:</span>
                      <span style={{ color: '#1e293b', fontWeight: '700' }}>{results.feature_count} variables</span>
                    </div>
                  </div>
                </div>

                <div style={{ background: '#f8fafc', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'left' }}>
                  <h4 style={{ margin: '0 0 16px 0', fontSize: '15px', color: '#1e293b', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', fontWeight: '600' }}>
                    Variable & Method Configuration
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', alignItems: 'center' }}>
                      <span style={{ color: '#64748b', fontWeight: '500' }}>Outcome Variable:</span>
                      <span style={{ color: '#1e293b', fontWeight: '700', fontFamily: 'monospace', background: '#e2e8f0', padding: '3px 8px', borderRadius: '6px', fontSize: '13px' }}>{analysisConfig?.outcome_column}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', alignItems: 'center' }}>
                      <span style={{ color: '#64748b', fontWeight: '500' }}>Intervention Variable:</span>
                      <span style={{ color: '#1e293b', fontWeight: '700', fontFamily: 'monospace', background: '#e2e8f0', padding: '3px 8px', borderRadius: '6px', fontSize: '13px' }}>{analysisConfig?.intervention_column}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', alignItems: 'center' }}>
                      <span style={{ color: '#64748b', fontWeight: '500' }}>Causal Estimation Method:</span>
                      <span style={{ color: '#4f46e5', fontWeight: '700' }}>{selectedMethod === 'kfold' ? 'K-Fold Method' : selectedMethod.charAt(0).toUpperCase() + selectedMethod.slice(1) + ' Method'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', alignItems: 'center' }}>
                      <span style={{ color: '#64748b', fontWeight: '500' }}>Uplift Split Rule:</span>
                      <span style={{ color: '#1e293b', fontWeight: '700' }}>Median ITE Split</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : activeTab === 'causal' ? (
          <div className="causal-validation" style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '30px',
            textAlign: 'left',
            marginTop: '10px'
          }}>
            {/* 1. PROPENSITY SCORE OVERLAP & POSITIVITY */}
            <div className="validation-section" style={{
              background: '#ffffff',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
              border: '1px solid #f1f5f9'
            }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '18px', color: '#1e293b' }}>
                1. Propensity Score Function & Overlap Trimming
              </h3>
              <p style={{ fontSize: '14px', color: '#64748b', lineHeight: '1.6', margin: '0 0 15px 0' }}>
                The Propensity Score Function is the probability of receiving treatment given the covariates, serving as a balancing score to reduce confounding. To ensure the critical <strong>positivity assumption</strong> is met, a symmetric trimming rule is applied, restricting propensity scores to a range of 0.1 to 0.9.
              </p>
              
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '25px', alignItems: 'center' }}>
                <div style={{ flex: '1 1 300px' }}>
                  <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>Mathematical Definition (Equation 16):</span>
                  <img src="/Pics/Equation_16.png" alt="Equation 16" style={{ maxHeight: '55px', display: 'block', margin: '12px 0' }} />
                </div>
                <div style={{ flex: '1 1 300px', background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#475569' }}>Trimmed Sample Diagnostic</h4>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>Original Sample Count:</span>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#334155' }}>{results.sample_size}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>Post-Trimming Count (0.1 - 0.9):</span>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#334155' }}>{results.trimmed_size}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>Excluded Outliers:</span>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#ef4444' }}>{results.trimmed_count} ({((results.trimmed_count / results.sample_size) * 100).toFixed(1)}%)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. COVARIATE BALANCE (SMD) */}
            <div className="validation-section" style={{
              background: '#ffffff',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
              border: '1px solid #f1f5f9'
            }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '18px', color: '#1e293b' }}>
                2. Covariate Balance Assessment (Standardized Mean Difference)
              </h3>
              <p style={{ fontSize: '14px', color: '#64748b', lineHeight: '1.6', margin: '0 0 15px 0' }}>
                The Standardized Mean Difference (SMD) is used to assess covariate balance between treatment and control groups. Standard diagnostics in epidemiology specify an SMD threshold of less than 0.1 or 0.2 to represent adequate balance.
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '25px' }}>
                <div style={{ flex: '1 1 300px' }}>
                  <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>Mathematical Definition (Equation 15):</span>
                  <img src="/Pics/Equation_15.png" alt="Equation 15" style={{ maxHeight: '70px', display: 'block', margin: '12px 0' }} />
                </div>
                <div style={{ flex: '2 1 450px' }}>
                  <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>Covariate Balance Comparison Table</span>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '12px', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                        <th style={{ padding: '8px' }}>Covariate</th>
                        <th style={{ padding: '8px' }}>Pre-Trimming SMD</th>
                        <th style={{ padding: '8px' }}>Post-Trimming SMD</th>
                        <th style={{ padding: '8px' }}>Balance Status (&lt; 0.2)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.keys(results.smd_pre).map((cov, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px', fontWeight: '500', color: '#334155' }}>{cov}</td>
                          <td style={{ padding: '8px', color: '#64748b' }}>{results.smd_pre[cov].toFixed(4)}</td>
                          <td style={{ padding: '8px', color: '#10b981', fontWeight: '600' }}>{results.smd_post[cov].toFixed(4)}</td>
                          <td style={{ padding: '8px' }}>
                            <span style={{
                              backgroundColor: results.smd_post[cov] < 0.2 ? '#d1fae5' : '#fee2e2',
                              color: results.smd_post[cov] < 0.2 ? '#065f46' : '#991b1b',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: '600',
                              display: 'inline-block'
                            }}>
                              {results.smd_post[cov] < 0.2 ? 'Balanced ✓' : 'Imbalanced ✗'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* 3. MODEL ACCURACY */}
            <div className="validation-section" style={{
              background: '#ffffff',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
              border: '1px solid #f1f5f9'
            }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '18px', color: '#1e293b' }}>
                3. Model Performance Evaluation (Directional Accuracy)
              </h3>
              <p style={{ fontSize: '14px', color: '#64748b', lineHeight: '1.6', margin: '0 0 15px 0' }}>
                Evaluates how accurately the model predicts a beneficial individual treatment effect (ITE) by calculating directional prediction accuracy. Clinical literature indicates a balanced accuracy of 65% to 67% as the threshold for clinical utility; achieving &gt;70% aligns with exceptional diagnostic standards.
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '25px', alignItems: 'center' }}>
                <div style={{ flex: '1 1 300px' }}>
                  <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>Mathematical Definition (Equation 17):</span>
                  <img src="/Pics/Equation_17.png" alt="Equation 17" style={{ maxHeight: '60px', display: 'block', margin: '12px 0' }} />
                </div>
                <div style={{ flex: '1 1 300px', display: 'flex', gap: '15px' }}>
                  <div style={{
                    flex: '1',
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '8px',
                    padding: '15px',
                    textAlign: 'center'
                  }}>
                    <span style={{ fontSize: '12px', color: '#166534', fontWeight: '600' }}>Computed Accuracy</span>
                    <div style={{ fontSize: '32px', fontWeight: '800', color: '#15803d', margin: '5px 0' }}>
                      {(currentMethodResults.accuracy.value * 100).toFixed(1)}%
                    </div>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: '700',
                      color: currentMethodResults.accuracy.value >= 0.7 ? '#166534' : '#991b1b',
                      backgroundColor: currentMethodResults.accuracy.value >= 0.7 ? '#dcfce7' : '#fee2e2',
                      padding: '2px 8px',
                      borderRadius: '10px'
                    }}>
                      {currentMethodResults.accuracy.value >= 0.7 ? 'PASSED CLINICAL THRESHOLD' : 'MODERATE ACCURACY'}
                    </span>
                  </div>
                  
                  <div style={{ flex: '1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11px' }}>
                    <div style={{ background: '#f8fafc', padding: '6px', borderRadius: '4px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                      <div style={{ color: '#64748b' }}>TP</div>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: '#334155' }}>{currentMethodResults.accuracy.tp}</div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '6px', borderRadius: '4px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                      <div style={{ color: '#64748b' }}>FP</div>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: '#334155' }}>{currentMethodResults.accuracy.fp}</div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '6px', borderRadius: '4px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                      <div style={{ color: '#64748b' }}>FN</div>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: '#334155' }}>{currentMethodResults.accuracy.fn}</div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '6px', borderRadius: '4px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                      <div style={{ color: '#64748b' }}>TN</div>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: '#334155' }}>{currentMethodResults.accuracy.tn}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. QINI SCORE */}
            <div className="validation-section" style={{
              background: '#ffffff',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
              border: '1px solid #f1f5f9'
            }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '18px', color: '#1e293b' }}>
                4. Targeting Prioritization (Qini Uplift Coefficient)
              </h3>
              <p style={{ fontSize: '14px', color: '#64748b', lineHeight: '1.6', margin: '0 0 15px 0' }}>
                The Qini Score calculates the area between the model's cumulative treatment curve and a random assignment strategy. A higher Qini Score indicates that the model effectively prioritizes individuals most likely to benefit from the treatment.
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '25px', alignItems: 'center' }}>
                <div style={{ flex: '1 1 300px' }}>
                  <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>Mathematical Definition (Equation 18):</span>
                  <img src="/Pics/Equation_18.png" alt="Equation 18" style={{ maxHeight: '55px', display: 'block', margin: '12px 0' }} />
                </div>
                <div style={{ flex: '1 1 300px', background: '#faf5ff', padding: '15px', borderRadius: '8px', border: '1px solid #f3e8ff', textAlign: 'center' }}>
                  <span style={{ fontSize: '12px', color: '#6b21a8', fontWeight: '600' }}>Calculated Qini Score</span>
                  <div style={{ fontSize: '36px', fontWeight: '800', color: '#7e22ce', margin: '5px 0' }}>
                    {currentMethodResults.qini_score.toFixed(4)}
                  </div>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    color: '#6b21a8',
                    backgroundColor: '#f3e8ff',
                    padding: '2px 8px',
                    borderRadius: '10px'
                  }}>
                    {currentMethodResults.qini_score > 0.1 ? 'SIGNIFICANT UPLIFT PRIORITIZATION ✓' : 'LOW PRIORITIZATION'}
                  </span>
                </div>
              </div>
            </div>

            {/* 5. REGRESSION VALIDATION */}
            <div className="validation-section" style={{
              background: '#ffffff',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
              border: '1px solid #f1f5f9'
            }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '18px', color: '#1e293b' }}>
                5. Out-of-Sample Regression Validation (Kuhlemeier et al., 2024)
              </h3>
              <p style={{ fontSize: '14px', color: '#64748b', lineHeight: '1.6', margin: '0 0 15px 0' }}>
                Following the prediction approach of Kuhlemeier et al. (2024), we estimate pseudo-observed treatment effects (obs) on out-of-sample respondents using Nearest Neighbor (NN) matching on predictions. We then regress these pseudo-observed outcomes on predicted individual treatment effects (PITEs).
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '25px', alignItems: 'center' }}>
                <div style={{ flex: '1 1 300px' }}>
                  <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>Mathematical Definition (Equation 19):</span>
                  <img src="/Pics/Equation_19.png" alt="Equation 19" style={{ maxHeight: '55px', display: 'block', margin: '12px 0' }} />
                </div>
                
                <div style={{ flex: '1.5 1 350px', display: 'flex', gap: '15px' }}>
                  <div style={{ flex: '1', background: '#e0f2fe', padding: '15px', borderRadius: '8px', border: '1px solid #bae6fd', textAlign: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#0369a1', fontWeight: '600' }}>Validation Slope (β₁)</span>
                    <div style={{ fontSize: '28px', fontWeight: '800', color: '#0284c7', margin: '5px 0' }}>
                      {currentMethodResults.regression.slope.toFixed(4)}
                    </div>
                    <span style={{ fontSize: '11px', color: '#0369a1' }}>Target: 1.0 (Perfect calibration)</span>
                  </div>

                  <div style={{ flex: '1', background: '#f0fdfa', padding: '15px', borderRadius: '8px', border: '1px solid #ccfbf1', textAlign: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#0f766e', fontWeight: '600' }}>Regression R²</span>
                    <div style={{ fontSize: '28px', fontWeight: '800', color: '#0d9488', margin: '5px 0' }}>
                      {(currentMethodResults.regression.r2 * 100).toFixed(1)}%
                    </div>
                    <span style={{ fontSize: '11px', color: '#0f766e' }}>Out-of-Sample variance explained</span>
                  </div>
                </div>
              </div>

              <div style={{
                marginTop: '15px',
                background: '#f8fafc',
                padding: '12px 18px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                fontSize: '13px',
                fontFamily: 'monospace',
                color: '#334155'
              }}>
                <strong>Fitted Model Equation:</strong> obs = {currentMethodResults.regression.intercept >= 0 ? '+' : '-'} {Math.abs(currentMethodResults.regression.intercept).toFixed(4)} + {currentMethodResults.regression.slope.toFixed(4)} * PITE (R² = {(currentMethodResults.regression.r2 * 100).toFixed(2)}%)
              </div>
            </div>
          </div>
        ) : activeTab === 'classification_tree' ? (
          <div className="validation-section" style={{
            background: '#ffffff',
            padding: '24px',
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
            border: '1px solid #f1f5f9'
          }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '18px', color: '#1e293b' }}>
              Classification Tree
            </h3>
            <p style={{ fontSize: '14px', color: '#64748b', lineHeight: '1.6', margin: '0 0 15px 0' }}>
              This classification tree models the binary treatment recommendation (above or below the median individual treatment effect) based on patient features.
            </p>
            {currentMethodResults.visualizations?.classification_tree ? (
              <div style={{ textAlign: 'center', width: '100%', overflowX: 'auto' }}>
                <img 
                  src={currentMethodResults.visualizations.classification_tree} 
                  alt="Classification Tree" 
                  style={{ maxWidth: '100%', height: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }} 
                />
              </div>
            ) : (
              <div style={{ padding: '40px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', color: '#64748b' }}>
                Visualization not available for this attempt.
              </div>
            )}
          </div>
        ) : activeTab === 'decision_tree' ? (
          <div className="validation-section" style={{
            background: '#ffffff',
            padding: '24px',
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
            border: '1px solid #f1f5f9'
          }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '18px', color: '#1e293b' }}>
              Regression Tree
            </h3>
            <p style={{ fontSize: '14px', color: '#64748b', lineHeight: '1.6', margin: '0 0 15px 0' }}>
              This regression decision tree predicts the continuous Individual Treatment Effect (ITE) directly from patient characteristics.
            </p>
            {currentMethodResults.visualizations?.decision_tree ? (
              <div style={{ textAlign: 'center', width: '100%', overflowX: 'auto' }}>
                <img 
                  src={currentMethodResults.visualizations.decision_tree} 
                  alt="Decision Tree" 
                  style={{ maxWidth: '100%', height: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }} 
                />
              </div>
            ) : (
              <div style={{ padding: '40px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', color: '#64748b' }}>
                Visualization not available for this attempt.
              </div>
            )}
          </div>
        ) : activeTab === 'shap' ? (
          <div className="validation-section" style={{
            background: '#ffffff',
            padding: '24px',
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
            border: '1px solid #f1f5f9',
            textAlign: 'left'
          }}>
            <div className="axioms-validation" style={{ marginTop: '0px', marginBottom: '24px' }}>
              <h3>Axiom Validation</h3>
              <div className="axioms-list">
                {Object.entries(currentMethodResults.axioms).map(([axiom, passed], index) => (
                  <div key={index} className={`axiom-item ${passed ? 'passed' : 'failed'}`}>
                    <div className="axiom-status">
                      {passed ? '✓' : '✗'}
                    </div>
                    <div className="axiom-content">
                      <span className="axiom-name">{axiom}</span>
                      <span className={`axiom-result ${passed ? 'pass' : 'fail'}`}>
                        {passed ? 'PASSED' : 'FAILED'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <h3 style={{ margin: '0 0 10px 0', fontSize: '18px', color: '#1e293b' }}>
              SHAP Explanations & Model Interpretation
            </h3>
            <p style={{ fontSize: '14px', color: '#64748b', lineHeight: '1.6', margin: '0 0 20px 0' }}>
              SHAP (SHapley Additive exPlanations) values provide local, mathematically consistent explanations of feature impacts by assigning an attribution score to each characteristic.
            </p>

            {/* SHAP MODEL SUB-SELECTOR */}
            <div style={{ 
              display: 'flex', 
              gap: '10px', 
              marginBottom: '25px', 
              padding: '4px', 
              background: '#f1f5f9', 
              borderRadius: '10px', 
              width: 'fit-content',
              flexWrap: 'wrap'
            }}>
              {[
                { id: 'rf', label: `${selectedMethod === 'kfold' ? 'K-Fold' : selectedMethod.charAt(0).toUpperCase() + selectedMethod.slice(1)} RF Model` },
                { id: 'regression', label: 'Regression Tree' },
                { id: 'classification', label: 'Classification Tree' }
              ].map(model => (
                <button
                  key={model.id}
                  onClick={() => setSelectedShapModel(model.id)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: selectedShapModel === model.id ? '#6366f1' : 'transparent',
                    boxShadow: selectedShapModel === model.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    color: selectedShapModel === model.id ? '#ffffff' : '#64748b',
                    fontWeight: selectedShapModel === model.id ? '700' : '500',
                    fontSize: '13px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {model.label}
                </button>
              ))}
            </div>

            {shapData ? (
              <>
                <p style={{ fontSize: '14px', color: '#475569', lineHeight: '1.6', margin: '0 0 20px 0', paddingLeft: '12px', borderLeft: '3px solid #6366f1', background: '#f8fafc', padding: '10px 14px', borderRadius: '4px 8px 8px 4px' }}>
                  <strong>Model Context:</strong> {getShapDescription()}
                </p>

                {/* SHAP Summary Plot */}
                <div style={{ 
                  background: '#ffffff', 
                  border: '1px solid #f1f5f9', 
                  borderRadius: '12px', 
                  padding: '20px', 
                  marginBottom: '30px', 
                  textAlign: 'center', 
                  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)' 
                }}>
                  <h4 style={{ margin: '0 0 15px 0', fontSize: '15px', color: '#334155', fontWeight: '700', textAlign: 'left' }}>
                    SHAP Summary Plot
                  </h4>
                  <div style={{ overflowX: 'auto', width: '100%' }}>
                    <img 
                      src={shapData.shap_summary} 
                      alt="SHAP Summary Plot" 
                      style={{ maxWidth: '100%', height: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }} 
                    />
                  </div>
                </div>

                {/* SHAP Dependence Plots */}
                <div style={{ marginTop: '30px' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#1e293b', fontWeight: '700' }}>
                    Top 3 Feature Dependence Plots
                  </h4>
                  <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px 0', lineHeight: '1.5' }}>
                    Dependence plots illustrate how a feature's raw value (x-axis) influences its SHAP prediction impact (y-axis). Colors show the value of the most strongly interacting feature.
                  </p>
                  {shapData.shap_dependence && Object.keys(shapData.shap_dependence).length > 0 ? (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                      gap: '20px',
                      marginTop: '15px'
                    }}>
                      {shapData.top_features?.map((feat, idx) => {
                        const plotImg = shapData.shap_dependence[feat];
                        if (!plotImg) return null;
                        return (
                          <div 
                            key={feat}
                            className="dependence-card"
                            onClick={() => setFullscreenPlot({ img: plotImg, title: `SHAP Dependence: ${feat} (${selectedShapModel === 'rf' ? 'RF' : selectedShapModel === 'regression' ? 'Regression Tree' : 'Classification Tree'})` })}
                            style={{
                              background: '#f8fafc',
                              border: '1px solid #e2e8f0',
                              borderRadius: '12px',
                              padding: '16px',
                              cursor: 'pointer',
                              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                              boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                              position: 'relative',
                              overflow: 'hidden'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.transform = 'translateY(-4px)';
                              e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.08)';
                              e.currentTarget.style.borderColor = '#6366f1';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'none';
                              e.currentTarget.style.boxShadow = '0 1px 2px 0 rgba(0, 0, 0, 0.05)';
                              e.currentTarget.style.borderColor = '#e2e8f0';
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                              <span style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b' }}>
                                {feat}
                              </span>
                              <span style={{
                                fontSize: '11px',
                                fontWeight: '700',
                                color: '#6366f1',
                                background: '#e0e7ff',
                                padding: '2px 8px',
                                borderRadius: '12px'
                              }}>
                                Rank #{idx + 1}
                              </span>
                            </div>
                            <div style={{ textAlign: 'center', width: '100%', overflow: 'hidden', borderRadius: '6px', background: '#ffffff', border: '1px solid #f1f5f9' }}>
                              <img 
                                src={plotImg} 
                                alt={`SHAP Dependence for ${feat}`} 
                                style={{ width: '100%', height: 'auto', display: 'block' }} 
                              />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '10px', fontSize: '11px', color: '#828fa9', gap: '4px' }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                              </svg>
                              Click to zoom
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ padding: '30px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', color: '#64748b', fontSize: '13px' }}>
                      No feature dependence plots available.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ padding: '40px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', color: '#64748b' }}>
                SHAP visualizations are not available for this model type under the selected attempt.
              </div>
            )}
          </div>
        ) : null}

      <div className="results-actions" style={{ marginTop: '30px' }}>
        <button 
          onClick={handleBackToConfig}
          className="btn btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Back to Configuration
        </button>
        <button 
          onClick={downloadResults}
          className="btn btn-secondary"
        >
          Download Results
        </button>
        <button 
          onClick={() => navigate('/')}
          className="btn btn-primary"
        >
          New Analysis
        </button>
      </div>

      <div className="results-footer">
        <p className="disclaimer">
          <strong>Note:</strong> This is a simplified Virtual Twins implementation for thesis validation. 
          Results are for demonstration and academic purposes. For production use, consider more 
          sophisticated modeling approaches and thorough validation procedures.
        </p>
      </div>

      {/* FULLSCREEN PLOT MODAL */}
      {fullscreenPlot && (
        <div 
          onClick={() => setFullscreenPlot(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
            cursor: 'pointer'
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              padding: '24px',
              maxWidth: '900px',
              width: '100%',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              position: 'relative',
              cursor: 'default'
            }}
          >
            <button
              onClick={() => setFullscreenPlot(null)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: '#f1f5f9',
                border: 'none',
                color: '#64748b',
                fontSize: '18px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#e2e8f0'}
              onMouseLeave={(e) => e.currentTarget.style.background = '#f1f5f9'}
            >
              ×
            </button>
            <h3 style={{ margin: '0 0 15px 0', fontSize: '18px', color: '#1e293b', fontWeight: '800' }}>
              {fullscreenPlot.title}
            </h3>
            <div style={{ textAlign: 'center', overflow: 'hidden', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#ffffff' }}>
              <img 
                src={fullscreenPlot.img} 
                alt={fullscreenPlot.title} 
                style={{ maxWidth: '100%', maxHeight: '70vh', height: 'auto', display: 'block', margin: '0 auto' }} 
              />
            </div>
            <p style={{ margin: '15px 0 0 0', fontSize: '13px', color: '#64748b', textAlign: 'center' }}>
              Click anywhere outside or the "×" button to close this preview.
            </p>
          </div>
        </div>
      )}
    </div>
  </div>
);
};

export default Results;