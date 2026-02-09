# DocVault File Naming Standard

This document defines the standard naming convention for tax documents in DocVault.

## Core Principles

1. **ISO dates**: Use `YYYY-MM-DD` format (e.g., `2025-01-15`)
2. **Underscores**: Use `_` to separate components, no spaces
3. **Order**: `{Source}_{Type}_{Date}.{ext}` - date is always LAST
4. **Lowercase types**: Document types are lowercase with hyphens (e.g., `1099-nec`)
5. **Title case sources**: Company/employer names use Title_Case

---

## Naming Patterns by Document Type

### W-2 Forms

**Pattern:** `{Employer}_W2_{Year}.pdf`

**Examples:**

```
Google_W2_2024.pdf
Meta_Platforms_W2_2024.pdf
Acme_Corp_W2_2024.pdf
```

**Notes:**

- Year only (not full date) since W-2s are annual
- Employer name with underscores replacing spaces

---

### 1099 Forms

**Pattern:** `{Payer}_1099-{type}_{Year}.pdf`

**Types:** `nec`, `misc`, `div`, `int`, `b`, `r`, `sa`

**Examples:**

```
Science_Partners_1099-nec_2025.pdf
Art_City_1099-nec_2025.pdf
Fidelity_1099-div_2024.pdf
Chase_Bank_1099-int_2024.pdf
Schwab_1099-b_2024.pdf
```

**Notes:**

- Year only since 1099s are annual
- Type suffix indicates the 1099 variant

---

### Invoices (Sent)

**Pattern:** `{Client}_Invoice_{Year}-{MM}.pdf`

**Examples:**

```
Teraflop_Invoice_2025-01.pdf
Art_City_Invoice_2025-08.pdf
Blueprint_Invoice_2025-04.pdf
DigitalWorks_Invoice_2025-06.pdf
```

**Notes:**

- Month format is `MM` (zero-padded)
- For multi-month invoices: `Science_Invoice_2025-08-09.pdf` (Aug-Sep)

---

### Receipts / Expenses

**Pattern:** `{Vendor}_{Category}_{Date}.{ext}` or `{Vendor}_{Category}_{Description}_{Date}.{ext}`

**Categories:**

- `meals` - Business meals
- `software` - Software and subscriptions
- `equipment` - Hardware and equipment
- `travel` - Travel expenses
- `office` - Office supplies
- `medical` - Medical expenses
- `childcare` - Childcare expenses

**Examples:**

```
OpenAI_software_2025-08-15.pdf
Restaurant_meals_Client-meeting_2025-08-29.jpeg
Apple_equipment_MacBook-Pro_2025-09-01.pdf
Delta_travel_SFO-to-NYC_2025-07-20.pdf
Staples_office_2025-01-15.pdf
```

**Notes:**

- Description is optional but helpful
- Use hyphens within description words
- Keep descriptions short (2-4 words max)
- For annual subscriptions without specific date: `Proton_software_2025.pdf`

---

### Tax Returns (Filed)

**Pattern:** `Return_{Status}_{Year}.pdf`

**Status options:** `filed`, `amended`, `draft`

**Examples:**

```
Return_filed_2024.pdf
Return_amended_2024.pdf
Return_filed_2023.pdf
```

---

### TurboTax Files

**Pattern:** `TurboTax_{Year}.tax{year}`

**Examples:**

```
TurboTax_2024.tax2024
TurboTax_2023.tax2023
```

---

### Crypto Reports

**Pattern:** `{Source}_Crypto_{Year}.{ext}`

**Sources:** `Koinly`, `Coinbase`, `Kraken`, `Webull`, `Form_8949`

**Examples:**

```
Koinly_Crypto_2024.pdf
Coinbase_Crypto_2024.csv
Form_8949_2018.pdf
```

---

### Business Documents (Formation, EIN, Licenses)

These are not tied to a tax year and go in `business-docs/` folder.

**EIN Letters:**

```
EIN_Letter.pdf
```

**Formation Documents:**

```
Articles_of_Organization.pdf
Operating_Agreement.pdf
Operating_Agreement_draft.pdf
Certificate_of_Formation.pdf
Certificate_of_Authority.pdf
```

**Licenses and Permits:**

```
Business_License_2025.pdf
Sales_Tax_Exemption.pdf
FVC_Membership.pdf
```

**Contracts and Agreements:**

```
{Company}_Contractor_Agreement.pdf
{Company}_NDA.pdf
{Company}_W9.pdf
{Company}_W9_{Year}.pdf
```

**Examples:**

```
Teraflop_Contractor_Agreement.pdf
Science_W9.pdf
Teraflop_W9_2024.pdf
```

---

## Folder Structure

```
{entity}/
├── {year}/
│   ├── income/
│   │   ├── w2/
│   │   │   └── Google_W2_2024.pdf
│   │   └── 1099/
│   │       ├── Art_City_1099-nec_2024.pdf
│   │       └── Fidelity_1099-div_2024.pdf
│   ├── expenses/
│   │   ├── business/
│   │   │   └── OpenAI_software_2024-08-15.pdf
│   │   ├── childcare/
│   │   └── medical/
│   ├── crypto/
│   │   └── Koinly_Crypto_2024.pdf
│   ├── returns/
│   │   └── Return_filed_2024.pdf
│   └── turbotax/
│       └── TurboTax_2024.tax2024
└── business-docs/
    ├── formation/
    │   └── Articles_of_Organization.pdf
    ├── ein/
    │   └── EIN_Letter.pdf
    ├── licenses/
    │   └── Business_License_2025.pdf
    └── contracts/
        └── Teraflop_Contractor_Agreement.pdf
```

---

## Renaming Guidelines

When renaming existing files:

1. **Preserve original info** - Don't lose payer names, dates, or amounts
2. **Standardize gradually** - Rename as you encounter files, not all at once
3. **Check parsed data** - Ensure DocVault's parsed data still maps correctly

### Common Transformations

| Original                                                 | Standard                                          |
| -------------------------------------------------------- | ------------------------------------------------- |
| `2025_1099_NEC_from_Science_Partners_Management_LLC.pdf` | `Science_Partners_1099-nec_2025.pdf`              |
| `Art-City-1099-NEC_2025.pdf`                             | `Art_City_1099-nec_2025.pdf`                      |
| `Art City Invoice - August 2025.pdf`                     | `Art_City_Invoice_2025-08.pdf`                    |
| `Teraflop Invoice - January 2025.pdf`                    | `Teraflop_Invoice_2025-01.pdf`                    |
| `15AUG2025 – Extended workday meal.jpeg`                 | `Restaurant_meals_Client-meeting_2025-08-15.jpeg` |
| `OpenAI LLC Invoice 73366834.pdf`                        | `OpenAI_software_2024-12-20.pdf`                  |
| `CP575Notice_1705420211786.pdf`                          | `EIN_Letter.pdf`                                  |
| `Ford Adam W-2 2024.pdf`                                 | `Ford_W2_Adam_2024.pdf`                           |
| `ADAM MISCHKE 22.pdf`                                    | `Return_filed_2022.pdf`                           |

---

## Quick Reference

| Document  | Pattern                              | Example                             |
| --------- | ------------------------------------ | ----------------------------------- |
| W-2       | `{Employer}_W2_{Year}.pdf`           | `Google_W2_2024.pdf`                |
| 1099-NEC  | `{Payer}_1099-nec_{Year}.pdf`        | `Art_City_1099-nec_2025.pdf`        |
| 1099-DIV  | `{Payer}_1099-div_{Year}.pdf`        | `Fidelity_1099-div_2024.pdf`        |
| Invoice   | `{Client}_Invoice_{Year}-{MM}.pdf`   | `Teraflop_Invoice_2025-01.pdf`      |
| Receipt   | `{Vendor}_{Category}_{Date}.ext`     | `OpenAI_software_2025-08-15.pdf`    |
| Return    | `Return_{Status}_{Year}.pdf`         | `Return_filed_2024.pdf`             |
| TurboTax  | `TurboTax_{Year}.tax{year}`          | `TurboTax_2024.tax2024`             |
| Crypto    | `{Source}_Crypto_{Year}.ext`         | `Koinly_Crypto_2024.pdf`            |
| EIN       | `EIN_Letter.pdf`                     | `EIN_Letter.pdf`                    |
| Formation | `Articles_of_Organization.pdf`       | `Operating_Agreement.pdf`           |
| Contract  | `{Company}_Contractor_Agreement.pdf` | `Teraflop_Contractor_Agreement.pdf` |
