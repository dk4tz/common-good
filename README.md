# 🚀 Automated Supply Funnel - Common Good Marketplace

Automate project submissions via Monday.com: store data, generate reports, and route for Verified Impact Assets (VIAs) approval.

## 📌 Table of Contents

1. [🔧 Setup](#setup)
2. [📁 Directory Structure](#directory-structure)
3. [🛠 Admin Files](#admin-files)
4. [🤖 Future Enhancements](#future-enhancements)
5. [📜 License](#license)

## 🔧 Setup

### 📋 Prerequisites:

-   AWS Account
-   AWS CDK
-   Node.js 18
-   TypeScript

```bash
# Navigate to the project directory
cd supply-funnel

# Install dependencies
npm install

# Deploy using AWS CDK
cdk deploy

```

## 📁 Directory Structure

-   **🔹 Bin:**
    -   Executable script and primary deployment config for the cdk deploy command.
    -   At: `supply-funnel/bin`
-   **🔹 Lib:**

    -   An instance of AWS's [cdk.Stack](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.Stack.html) class called SupplyFunnelStack. Contains all cloud resource definitions.
    -   At: `supply-funnel/lib`

-   **🔹 Lambdas:**
    -   Node.js 18 functions.
    -   At: `supply-funnel/lambdas`

## 🛠 Admin Files

-   **🔸 Impact Assessment Scoring Key:**

    -   Location: `supply-funnel/lambdas/2-impact-assessment/scoring-key.ts`

-   **🔸 Config:**
    -   Location: `supply-funnel/bin/supply-funnel.ts`

## 🚀 Future Enhancements

-   **Integrate large language models**: Plan to provide first-draft answers for certification questions.

## 📜 License

**For non-commercial use only**.
