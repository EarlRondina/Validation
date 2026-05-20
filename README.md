# Virtual Twins Validation Dashboard

An interactive, high-fidelity web application built to run and validate **Virtual Twins** propensity score analysis, model performance metrics, causal axiom conformance, and multi-model feature interpretability (SHAP).

The project is split into a **Python Flask backend** (handling data processing, propensity scoring, machine learning, and SHAP calculation) and a **React frontend** (providing a premium, responsive dashboard interface).

---

## 📋 Prerequisites

Before running the application, ensure you have the following installed on your system:
* **Python 3.9+**
* **Node.js 16+** (with npm)

---

## 🚀 How to Run the Application

To run the application locally, you will need to start both the Python backend server and the React frontend client.

### Step 1: Start the Python Flask Backend

1. Open a terminal/command prompt and navigate to the `flask-server` directory:
   ```bash
   cd flask-server
   ```

2. Activate the pre-configured virtual environment:
   * **Windows (PowerShell)**:
     ```powershell
     .\venv\Scripts\Activate.ps1
     ```
     *(If script execution is disabled on your machine, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` first)*
   * **Windows (Command Prompt)**:
     ```cmd
     .\venv\Scripts\activate.bat
     ```
   * **macOS / Linux**:
     ```bash
     source venv/bin/activate
     ```

3. *(Optional)* If setting up a new environment or if any packages are missing, install the required dependencies:
   ```bash
   pip install flask flask-cors pandas numpy scikit-learn matplotlib shap
   ```

4. Run the backend server:
   ```bash
   python server.py
   ```
   The server will start on **`http://127.0.0.1:5000`**. Keep this terminal open.

---

### Step 2: Start the React Frontend Client

1. Open a **new** terminal/command prompt and navigate to the `client` directory:
   ```bash
   cd client
   ```

2. *(Optional)* If this is the first run, install the node packages:
   ```bash
   npm install
   ```

3. Start the React development server:
   * **Windows (Command Prompt / Unix Shell)**:
     ```bash
     npm start
     ```
   * **Windows (PowerShell)**:
     If your PowerShell execution policy blocks running scripts, start the server using the Command Prompt wrapper:
     ```powershell
     cmd /c npm start
     ```

The React application will automatically open in your default browser at **`http://localhost:3000`**.

---

## 🧪 Testing the Application (User Guide)

1. Once the React frontend loads at `http://localhost:3000`, click **Start Analysis**.
2. To test the pipeline, you can upload the pre-generated sample dataset located in the project directory:
   * File path: `flask-server/synthetic_vt_data.csv`
3. Map the columns in the UI configuration screen:
   * **Outcome Column**: `Target_outcome`
   * **Intervention Column**: `Intervention`
   * **Covariates**: Select all other variables (e.g., `Age`, `Biomarker_A`, `Biomarker_B`, etc.)
4. Select the validation method (e.g., **Simple**, **T-Learner**, or **K-Fold**) and click **Run Analysis**.
5. Once processing completes, explore the interactive tabs:
   * **Overview**: Standardized Mean Difference (SMD) balance comparison and model diagnostic R² scores.
   * **Classification Tree**: Visual representation of the treatment recommendation tree.
   * **Regression Tree**: Visual representation of the Individual Treatment Effect (ITE) regression tree.
   * **SHAP**: Axiom validation checks and interactive feature attribution summary and dependence plots for the Random Forest, Regression Tree, and Classification Tree. Click any dependence plot card to zoom in!
