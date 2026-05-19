import pandas as pd
import numpy as np

# Set random seed for reproducibility
np.random.seed(42)

# Generate synthetic dataset (1000 samples)
n_samples = 1000

# Features (covariates)
age = np.random.randint(18, 80, size=n_samples)
bmi = np.random.normal(25, 4, size=n_samples)
systolic_bp = np.random.normal(120, 15, size=n_samples)
gender = np.random.choice(['Male', 'Female'], size=n_samples)

# Treatment intervention (binary)
treatment = np.random.choice(['Control', 'Active Treatment'], size=n_samples)

# Convert treatment to numeric for outcome calculation
t_num = np.where(treatment == 'Active Treatment', 1, 0)
g_num = np.where(gender == 'Female', 1, 0)

# Outcome: Treatment response (e.g. reduction in blood pressure/symptom score)
# Strong relationship with age, bmi, and an interaction term for active treatment in older/high-bmi patients
base_response = 15.0 + 0.3 * age + 0.8 * bmi - 0.1 * systolic_bp + 2.5 * g_num
treatment_effect = 8.0 + 0.4 * age + 1.2 * (bmi - 25)  # Treatment works better for older or higher BMI patients
noise = np.random.normal(0, 1.0, size=n_samples)  # Keep noise small to ensure high R2

outcome = base_response + treatment_effect * t_num + noise

# Create DataFrame
df = pd.DataFrame({
    'Age': age,
    'BMI': bmi,
    'Systolic_BP': systolic_bp,
    'Gender': gender,
    'Intervention': treatment,
    'Outcome': outcome
})

# Save to CSV
df.to_csv('synthetic_vt_data.csv', index=False)
print("Synthetic dataset 'synthetic_vt_data.csv' generated successfully!")
print(f"Shape: {df.shape}")
print("Columns:", list(df.columns))
print(df.head())
