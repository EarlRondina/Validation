from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_squared_error
from sklearn.linear_model import LogisticRegression, LinearRegression
import io
import os

app = Flask(__name__)
CORS(app)

# Global variable to store uploaded dataset
uploaded_data = None
project_config = {}

@app.route("/upload", methods=["POST"])
def upload_file():
    global uploaded_data, project_config
    
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    file = request.files['file']
    project_title = request.form.get('project_title', 'Untitled Project')
    
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
    
    try:
        # Read CSV file
        file_content = file.read()
        uploaded_data = pd.read_csv(io.StringIO(file_content.decode('utf-8')))
        
        # Store project configuration
        project_config['title'] = project_title
        project_config['filename'] = file.filename
        project_config['shape'] = uploaded_data.shape
        
        # Return dataset info
        return jsonify({
            "message": "File uploaded successfully",
            "project_title": project_title,
            "filename": file.filename,
            "columns": list(uploaded_data.columns),
            "shape": uploaded_data.shape,
            "preview": uploaded_data.head().to_dict('records')
        })
    
    except Exception as e:
        return jsonify({"error": f"Error processing file: {str(e)}"}), 400

@app.route("/upload-preset", methods=["POST"])
def upload_preset():
    global uploaded_data, project_config
    
    data = request.get_json() or {}
    project_title = data.get('project_title', 'Synthetic Validation Project')
    filename = 'synthetic_vt_data.csv'
    filepath = os.path.join(os.path.dirname(__file__), filename)
    
    try:
        # Read synthetic CSV file
        uploaded_data = pd.read_csv(filepath)
        
        # Store project configuration
        project_config['title'] = project_title
        project_config['filename'] = filename
        project_config['shape'] = uploaded_data.shape
        
        # Return dataset info
        return jsonify({
            "message": "Preset file loaded successfully",
            "project_title": project_title,
            "filename": filename,
            "columns": list(uploaded_data.columns),
            "shape": uploaded_data.shape,
            "preview": uploaded_data.head().to_dict('records')
        })
    
    except Exception as e:
        return jsonify({"error": f"Error processing preset file: {str(e)}"}), 400

@app.route("/configure", methods=["POST"])
def configure_analysis():
    global project_config
    
    data = request.get_json()
    outcome_column = data.get('outcome_column')
    intervention_column = data.get('intervention_column')
    
    if not outcome_column or not intervention_column:
        return jsonify({"error": "Both outcome and intervention columns must be specified"}), 400
    
    project_config['outcome_column'] = outcome_column
    project_config['intervention_column'] = intervention_column
    
    return jsonify({
        "message": "Configuration saved",
        "outcome_column": outcome_column,
        "intervention_column": intervention_column
    })

import json
from flask import Response, stream_with_context

@app.route("/analyze", methods=["POST"])
def run_analysis():
    global uploaded_data, project_config
    
    if uploaded_data is None:
        return jsonify({"error": "No dataset uploaded"}), 400
    
    def generate():
        try:
            yield json.dumps({"type": "status", "attempt": 1, "message": "Pre-processing data and calculating propensity scores..."}) + "\n"
            
            outcome_col = project_config['outcome_column']
            intervention_col = project_config['intervention_column']
            
            df = uploaded_data.copy()
            
            # 1. Propensity Score Calculation & Overlap Trimming
            covariates_cols = [col for col in df.columns if col not in [outcome_col, intervention_col]]
            
            X_cov = df[covariates_cols].copy()
            for col in X_cov.select_dtypes(include=['object']).columns:
                X_cov[col] = pd.factorize(X_cov[col])[0]
                
            treatment_series = df[intervention_col].copy()
            
            unique_vals = treatment_series.dropna().unique()
            if len(unique_vals) == 2:
                positive_words = ['1', '1.0', 'true', 'yes', 'y', 'treatment', 'active', 't']
                val1, val2 = unique_vals
                if str(val1).lower() in positive_words:
                    treatment_binary = np.where(treatment_series == val1, 1, 0)
                elif str(val2).lower() in positive_words:
                    treatment_binary = np.where(treatment_series == val2, 1, 0)
                else:
                    treatment_binary = np.where(treatment_series == max(unique_vals), 1, 0)
            else:
                treatment_binary = np.where(
                    treatment_series.astype(str).str.lower().str.contains('treatment') | 
                    (treatment_series == 1) | 
                    (treatment_series == '1') |
                    (treatment_series == 1.0), 
                    1, 0
                )

            if len(np.unique(treatment_binary)) < 2:
                yield json.dumps({"type": "error", "message": f"The Intervention column '{intervention_col}' must contain exactly two distinct groups."}) + "\n"
                return
            
            ps_model = LogisticRegression(random_state=42, max_iter=1000)
            ps_model.fit(X_cov, treatment_binary)
            propensity_scores = ps_model.predict_proba(X_cov)[:, 1]
            
            df['propensity_score'] = propensity_scores
            df['treatment_binary'] = treatment_binary
            X_cov['propensity_score'] = propensity_scores
            X_cov['treatment_binary'] = treatment_binary
            
            # 2. SMD Pre-Trimming
            continuous_covs = [col for col in X_cov.columns if col not in ['propensity_score', 'treatment_binary']]
            smd_pre = {}
            for col in continuous_covs:
                treated_vals = X_cov[X_cov['treatment_binary'] == 1][col]
                control_vals = X_cov[X_cov['treatment_binary'] == 0][col]
                if len(treated_vals) > 1 and len(control_vals) > 1:
                    mean_t, mean_c = treated_vals.mean(), control_vals.mean()
                    var_t, var_c = treated_vals.var(), control_vals.var()
                    pooled_sd = np.sqrt((var_t + var_c) / 2.0)
                    smd = abs(mean_t - mean_c) / pooled_sd if pooled_sd > 0 else 0.0
                    smd_pre[col] = round(float(smd), 4)
                else:
                    smd_pre[col] = 0.0
                    
            trimmed_mask = (X_cov['propensity_score'] >= 0.1) & (X_cov['propensity_score'] <= 0.9)
            df_trimmed = df[trimmed_mask].copy()
            X_cov_trimmed = X_cov[trimmed_mask].copy()
            trimmed_count = len(df) - len(df_trimmed)
            
            if len(df_trimmed) < 50:
                df_trimmed = df.copy()
                X_cov_trimmed = X_cov.copy()
                trimmed_count = 0
                
            # 3. SMD Post-Trimming
            smd_post = {}
            for col in continuous_covs:
                treated_vals = X_cov_trimmed[X_cov_trimmed['treatment_binary'] == 1][col]
                control_vals = X_cov_trimmed[X_cov_trimmed['treatment_binary'] == 0][col]
                if len(treated_vals) > 1 and len(control_vals) > 1:
                    mean_t, mean_c = treated_vals.mean(), control_vals.mean()
                    var_t, var_c = treated_vals.var(), control_vals.var()
                    pooled_sd = np.sqrt((var_t + var_c) / 2.0)
                    smd = abs(mean_t - mean_c) / pooled_sd if pooled_sd > 0 else 0.0
                    smd_post[col] = round(float(smd), 4)
                else:
                    smd_post[col] = 0.0
                    
            features_trimmed = df_trimmed[covariates_cols].copy()
            for col in features_trimmed.select_dtypes(include=['object']).columns:
                features_trimmed[col] = pd.factorize(features_trimmed[col])[0]
                
            target_trimmed = df_trimmed[outcome_col]
            treatment_trimmed = df_trimmed['treatment_binary']
            
            X_train, X_test, y_train, y_test = train_test_split(
                features_trimmed, target_trimmed, test_size=0.2, random_state=42, stratify=treatment_trimmed
            )
            
            treatment_train = treatment_trimmed.loc[X_train.index]
            treatment_test = treatment_trimmed.loc[X_test.index]
            
            X_train_bench = X_train.copy()
            X_train_bench['Intervention_encoded'] = treatment_train
            X_test_bench = X_test.copy()
            X_test_bench['Intervention_encoded'] = treatment_test
            
            treated_train_mask = treatment_train == 1
            control_train_mask = treatment_train == 0
            
            # --- HYPERPARAMETER TUNING LOOP ---
            tuning_rounds = [
                {"n_estimators": 100, "max_depth": None, "min_samples_leaf": 1},
                {"n_estimators": 200, "max_depth": 10, "min_samples_leaf": 3},
                {"n_estimators": 300, "max_depth": 5, "min_samples_leaf": 5}
            ]
            
            from sklearn.model_selection import StratifiedKFold, KFold
            is_binary_outcome = len(np.unique(y_test)) <= 2

            attempts_results = []
            best_idx = 0
            best_models = {}
            
            for i, params in enumerate(tuning_rounds):
                yield json.dumps({"type": "status", "attempt": i + 1, "message": f"Training predictive models (Attempt {i + 1})..."}) + "\n"
                
                benchmark_model = RandomForestRegressor(random_state=42, **params)
                benchmark_model.fit(X_train_bench, y_train)
                benchmark_pred = benchmark_model.predict(X_test_bench)
                benchmark_r2 = float(r2_score(y_test, benchmark_pred))
                
                # 1. Double RF (T-Learner)
                vt_model_1 = RandomForestRegressor(random_state=42, **params)
                vt_model_0 = RandomForestRegressor(random_state=42, **params)
                vt_model_1.fit(X_train[treated_train_mask], y_train[treated_train_mask])
                vt_model_0.fit(X_train[control_train_mask], y_train[control_train_mask])
                y_pred_1_double = vt_model_1.predict(X_test)
                y_pred_0_double = vt_model_0.predict(X_test)
                
                # 2. Simple RF (S-Learner)
                simple_model = RandomForestRegressor(random_state=42, **params)
                simple_model.fit(X_train_bench, y_train)
                X_test_1 = X_test_bench.copy()
                X_test_1['Intervention_encoded'] = 1
                X_test_0 = X_test_bench.copy()
                X_test_0['Intervention_encoded'] = 0
                y_pred_1_simple = simple_model.predict(X_test_1)
                y_pred_0_simple = simple_model.predict(X_test_0)
                
                # 3. K-Fold RF
                k_splits = 5
                if is_binary_outcome:
                    kf = StratifiedKFold(n_splits=k_splits, shuffle=True, random_state=42)
                    splits = list(kf.split(X_train_bench, y_train))
                else:
                    kf = KFold(n_splits=k_splits, shuffle=True, random_state=42)
                    splits = list(kf.split(X_train_bench))
                
                p1_preds = np.zeros((len(X_test), k_splits))
                p0_preds = np.zeros((len(X_test), k_splits))
                
                for fold_i, (train_idx, val_idx) in enumerate(splits):
                    X_train_fold = X_train_bench.iloc[train_idx]
                    y_train_fold = y_train.iloc[train_idx]
                    rf = RandomForestRegressor(random_state=42, **params)
                    rf.fit(X_train_fold, y_train_fold)
                    p1_preds[:, fold_i] = rf.predict(X_test_1)
                    p0_preds[:, fold_i] = rf.predict(X_test_0)
                    
                y_pred_1_kfold = p1_preds.mean(axis=1)
                y_pred_0_kfold = p0_preds.mean(axis=1)
                
                current_models = {
                    "simple": simple_model,
                    "double_1": vt_model_1,
                    "double_0": vt_model_0,
                    "kfold_last": rf
                }
                
                methods_preds = {
                    "simple": (y_pred_1_simple, y_pred_0_simple),
                    "double": (y_pred_1_double, y_pred_0_double),
                    "kfold": (y_pred_1_kfold, y_pred_0_kfold)
                }
                
                methods_results = {}
                axiom_consistency_double = False
                
                from sklearn.metrics import roc_auc_score
                for m_name, (yp1, yp0) in methods_preds.items():
                    pite = yp1 - yp0
                    vt_combined_pred = np.where(treatment_test == 1, yp1, yp0)
                    vt_overall_r2 = float(r2_score(y_test, vt_combined_pred))
                    
                    test_df = pd.DataFrame({'outcome': y_test, 'treatment': treatment_test, 'pite': pite}, index=X_test.index)
                    treated_test_df = test_df[test_df['treatment'] == 1].copy()
                    control_test_df = test_df[test_df['treatment'] == 0].copy()
                    
                    matched_treated_pite = []
                    matched_pseudo_ite = []
                    if len(treated_test_df) > 0 and len(control_test_df) > 0:
                        for idx_t, row_t in treated_test_df.iterrows():
                            pite_t = row_t['pite']
                            control_match_idx = (control_test_df['pite'] - pite_t).abs().idxmin()
                            row_c = control_test_df.loc[control_match_idx]
                            pseudo_ite = row_t['outcome'] - row_c['outcome']
                            matched_treated_pite.append(pite_t)
                            matched_pseudo_ite.append(pseudo_ite)
                            
                    slope, intercept, reg_r2 = 0.0, 0.0, 0.0
                    if len(matched_treated_pite) > 5:
                        X_reg = np.array(matched_treated_pite).reshape(-1, 1)
                        y_reg = np.array(matched_pseudo_ite)
                        reg_model = LinearRegression()
                        reg_model.fit(X_reg, y_reg)
                        slope = float(reg_model.coef_[0])
                        intercept = float(reg_model.intercept_)
                        reg_r2 = float(reg_model.score(X_reg, y_reg))
                        
                    tp, tn, fp, fn, accuracy = 0, 0, 0, 0, 0.0
                    for p, o in zip(matched_treated_pite, matched_pseudo_ite):
                        pred_pos, obs_pos = p > 0, o > 0
                        if pred_pos and obs_pos: tp += 1
                        elif not pred_pos and not obs_pos: tn += 1
                        elif pred_pos and not obs_pos: fp += 1
                        elif not pred_pos and obs_pos: fn += 1
                            
                    total_matched = tp + tn + fp + fn
                    if total_matched > 0:
                        accuracy = float((tp + tn) / total_matched)
                        
                    sorted_test_df = test_df.sort_values(by='pite', ascending=False).copy()
                    n_test = len(sorted_test_df)
                    qini_y, random_y = [], []
                    
                    n_t_total = (sorted_test_df['treatment'] == 1).sum()
                    n_c_total = (sorted_test_df['treatment'] == 0).sum()
                    y_t_total = sorted_test_df[sorted_test_df['treatment'] == 1]['outcome'].sum()
                    y_c_total = sorted_test_df[sorted_test_df['treatment'] == 0]['outcome'].sum()
                    
                    cum_t_count, cum_c_count, cum_t_y, cum_c_y = 0, 0, 0.0, 0.0
                    for k in range(1, n_test + 1):
                        row = sorted_test_df.iloc[k - 1]
                        if row['treatment'] == 1:
                            cum_t_count += 1
                            cum_t_y += row['outcome']
                        else:
                            cum_c_count += 1
                            cum_c_y += row['outcome']
                            
                        q_val = cum_t_y - cum_c_y * (cum_t_count / cum_c_count if cum_c_count > 0 else 0)
                        q_rand = k * ((y_t_total - y_c_total * (n_t_total / n_c_total if n_c_total > 0 else 0)) / n_test)
                        qini_y.append(float(q_val))
                        random_y.append(float(q_rand))
                        
                    qini_area = float(np.sum(np.array(qini_y) - np.array(random_y)) / n_test)
                    qini_score = float(qini_area / abs(y_t_total) if y_t_total != 0 else qini_area)
                    
                    if is_binary_outcome:
                        if len(np.unique(y_test)) == 2:
                            vt_auc = roc_auc_score(y_test, vt_combined_pred)
                            axiom_consistency = bool(vt_auc > 0.60)
                        else:
                            axiom_consistency = bool(vt_overall_r2 > 0.3)
                    else:
                        axiom_consistency = bool(vt_overall_r2 > 0.3)
                        
                    if m_name == "double":
                        axiom_consistency_double = axiom_consistency

                    axioms = {
                        "Axiom 1: Consistency": axiom_consistency,
                        "Axiom 2: Stability": bool(abs(benchmark_r2 - vt_overall_r2) < 0.5),
                        "Axiom 3: Interpretability": bool(len(unique_vals) <= 10)
                    }
                    
                    methods_results[m_name] = {
                        "vt_method_r2": round(vt_overall_r2, 4),
                        "axioms": axioms,
                        "regression": {
                            "slope": round(slope, 4),
                            "intercept": round(intercept, 4),
                            "r2": round(reg_r2, 4)
                        },
                        "accuracy": {
                            "tp": int(tp), "tn": int(tn), "fp": int(fp), "fn": int(fn),
                            "value": round(accuracy, 4)
                        },
                        "qini_score": round(qini_score, 4),
                        "qini_curve": [round(y, 4) for y in qini_y[:20]],
                        "random_curve": [round(y, 4) for y in random_y[:20]],
                        "pite_list": pite.tolist()
                    }
                
                attempt_result = {
                    "attempt_id": i + 1,
                    "hyperparameters": params,
                    "benchmark_r2": round(benchmark_r2, 4),
                    "treatment_groups": int(df_trimmed[intervention_col].nunique()),
                    "sample_size": int(len(df)),
                    "trimmed_size": int(len(df_trimmed)),
                    "trimmed_count": int(trimmed_count),
                    "feature_count": int(len(covariates_cols)),
                    "smd_pre": smd_pre,
                    "smd_post": smd_post,
                    "methods": methods_results
                }
                
                attempts_results.append(attempt_result)
                
                if axiom_consistency_double:
                    yield json.dumps({"type": "status", "attempt": i + 1, "message": "Desired outcome achieved! Finalizing results..."}) + "\n"
                    best_idx = i
                    best_models = current_models
                    break
                else:
                    if i < len(tuning_rounds) - 1:
                        yield json.dumps({"type": "status", "attempt": i + 1, "message": f"Low performance (Axiom 1 failed). Training again with adjusted parameters..."}) + "\n"
                    else:
                        yield json.dumps({"type": "status", "attempt": i + 1, "message": "Max attempts reached. Returning best available models..."}) + "\n"
                        best_idx = i
                        best_models = current_models

            # Generate Visualizations after loop
            yield json.dumps({"type": "status", "attempt": len(tuning_rounds), "message": "Generating visualizations..."}) + "\n"

            try:
                import base64
                import io
                import matplotlib
                matplotlib.use('Agg')
                import matplotlib.pyplot as plt
                from sklearn.tree import DecisionTreeRegressor, DecisionTreeClassifier, plot_tree
                import shap

                def generate_shap_plots(model, X, title_suffix):
                    # 1. SHAP Values
                    explainer = shap.TreeExplainer(model)
                    shap_values = explainer.shap_values(X)
                    
                    if isinstance(shap_values, list):
                        shap_values_arr = shap_values[1] if len(shap_values) > 1 else shap_values[0]
                    elif hasattr(shap_values, 'shape') and len(shap_values.shape) == 3:
                        shap_values_arr = shap_values[:, :, 1] if shap_values.shape[2] > 1 else shap_values[:, :, 0]
                    else:
                        shap_values_arr = shap_values
                        
                    # 2. SHAP Summary Plot
                    plt.figure(figsize=(10, 6))
                    shap.summary_plot(shap_values_arr, X, show=False)
                    plt.title(f"SHAP Summary Plot ({title_suffix})", fontsize=14)
                    plt.tight_layout()
                    buf = io.BytesIO()
                    plt.savefig(buf, format='png', bbox_inches='tight')
                    plt.close()
                    summary_base64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode('utf-8')
                    
                    # 3. Top 3 Feature Dependence Plots
                    mean_abs_shap = np.abs(shap_values_arr).mean(axis=0)
                    top_3_idx = np.argsort(mean_abs_shap)[-3:][::-1]
                    top_3_features = X.columns[top_3_idx].tolist()
                    
                    dependence_plots = {}
                    for feat in top_3_features:
                        plt.figure(figsize=(8, 5))
                        shap.dependence_plot(feat, shap_values_arr, X, show=False)
                        plt.title(f"SHAP Dependence: {feat} ({title_suffix})", fontsize=12)
                        plt.tight_layout()
                        buf = io.BytesIO()
                        plt.savefig(buf, format='png', bbox_inches='tight')
                        plt.close()
                        dependence_plots[feat] = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode('utf-8')
                        
                    return {
                        "shap_summary": summary_base64,
                        "shap_dependence": dependence_plots,
                        "top_features": top_3_features
                    }

                for m_name in attempts_results[best_idx]["methods"]:
                    pite = np.array(attempts_results[best_idx]["methods"][m_name]["pite_list"])
                    
                    # 1. Decision Tree
                    reg_SRF = DecisionTreeRegressor(max_depth=3, random_state=42)
                    reg_SRF.fit(X_test, pite)
                    plt.figure(figsize=(20, 10))
                    plot_tree(reg_SRF, feature_names=X_test.columns, filled=True, rounded=True, precision=2)
                    plt.title(f"Decision Tree for ITE ({m_name.capitalize()} VT)", fontsize=16)
                    buf = io.BytesIO()
                    plt.savefig(buf, format='png', bbox_inches='tight')
                    plt.close()
                    dt_base64 = base64.b64encode(buf.getvalue()).decode('utf-8')

                    # 2. Classification Tree
                    c_threshold = np.median(pite) if len(pite) > 0 else 0
                    Z_star = (pite > c_threshold).astype(int)
                    clf_SRF = DecisionTreeClassifier(max_depth=3, min_samples_split=10, random_state=42)
                    clf_SRF.fit(X_test, Z_star)
                    plt.figure(figsize=(20, 10))
                    plot_tree(clf_SRF, feature_names=X_test.columns, filled=True, rounded=True, class_names=['Below Threshold', 'Above Threshold'], precision=2)
                    plt.title(f"Classification Tree (Threshold = {c_threshold:.2f}, {m_name.capitalize()} VT)", fontsize=16)
                    buf = io.BytesIO()
                    plt.savefig(buf, format='png', bbox_inches='tight')
                    plt.close()
                    ct_base64 = base64.b64encode(buf.getvalue()).decode('utf-8')

                    # 3. Generate SHAP for Regression Tree
                    shap_reg = generate_shap_plots(reg_SRF, X_test, f"Regression Tree, {m_name.capitalize()} VT")
                    
                    # 4. Generate SHAP for Classification Tree
                    shap_clf = generate_shap_plots(clf_SRF, X_test, f"Classification Tree, {m_name.capitalize()} VT")
                    
                    # 5. Generate SHAP for RF Model
                    shap_rf = None
                    if best_models:
                        try:
                            if m_name == "simple" and "simple" in best_models:
                                shap_rf = generate_shap_plots(best_models["simple"], X_test_bench, f"Simple RF, {m_name.capitalize()} VT")
                            elif m_name == "double" and "double_1" in best_models:
                                shap_rf = generate_shap_plots(best_models["double_1"], X_test, f"Double RF (Treated), {m_name.capitalize()} VT")
                            elif m_name == "kfold" and "kfold_last" in best_models:
                                shap_rf = generate_shap_plots(best_models["kfold_last"], X_test_bench, f"K-Fold RF, {m_name.capitalize()} VT")
                        except Exception as shap_rf_e:
                            print(f"Error generating SHAP for RF under {m_name}:", shap_rf_e)

                    attempts_results[best_idx]["methods"][m_name]["visualizations"] = {
                        "decision_tree": "data:image/png;base64," + dt_base64,
                        "classification_tree": "data:image/png;base64," + ct_base64,
                        "shap_regression_tree": shap_reg,
                        "shap_classification_tree": shap_clf,
                        "shap_rf": shap_rf
                    }
                    del attempts_results[best_idx]["methods"][m_name]["pite_list"]

            except Exception as e:
                print("Visualization error:", e)

            # Finished loop
            yield json.dumps({
                "type": "complete", 
                "attempts": attempts_results, 
                "best_idx": best_idx
            }) + "\n"
            
        except Exception as e:
            yield json.dumps({"type": "error", "message": f"Analysis failed: {str(e)}"}) + "\n"
            
    return Response(stream_with_context(generate()), mimetype='application/x-ndjson')

@app.route("/project-info", methods=["GET"])
def get_project_info():
    global project_config
    return jsonify(project_config)

# Keep the original members route for testing
@app.route("/members")
def members():
    return {"members": ["Member1", "Member2", "Member3"]}

if __name__ == "__main__":
    app.run(debug=True)