#!/bin/bash
# TaxVault File Rename Script
# Generated based on NAMING_STANDARD.md
# Pattern: {Source}_{Type}_{Date} - date always LAST
#
# Run with: bash scripts/rename_files.sh --dry-run
# Execute:  bash scripts/rename_files.sh

DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
    DRY_RUN=true
    echo "=== DRY RUN MODE - No files will be renamed ==="
    echo ""
fi

TAXES_DIR="/Users/vanities/Library/CloudStorage/Dropbox/important/taxes"
AM2_DIR="/Users/vanities/Library/CloudStorage/Dropbox/important/AM2 LLC"
MANNA_DIR="/Users/vanities/Library/CloudStorage/Dropbox/important/Manna of the Valley LLC"

rename_file() {
    local src="$1"
    local dst="$2"

    if [[ ! -f "$src" ]]; then
        echo "SKIP (not found): $(basename "$src")"
        return
    fi

    if [[ -f "$dst" ]]; then
        echo "SKIP (exists): $(basename "$dst")"
        return
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        echo "RENAME: $(basename "$src")"
        echo "    ->  $(basename "$dst")"
    else
        mv "$src" "$dst"
        echo "RENAMED: $(basename "$src") -> $(basename "$dst")"
    fi
}

echo "=========================================="
echo "PERSONAL TAX DOCUMENTS"
echo "=========================================="

# --- W-2s ---
echo ""
echo "--- W-2 Forms ---"

# 2022 W-2s
rename_file "$TAXES_DIR/2022/income/w2/FUNFUNFUN-Form_W-2_Tax_Year_2022.pdf" \
            "$TAXES_DIR/2022/income/w2/FunFunFun_W2_2022.pdf"
rename_file "$TAXES_DIR/2022/income/w2/COINMINE-Form_W-2_Tax_Year_2022.pdf" \
            "$TAXES_DIR/2022/income/w2/Coinmine_W2_2022.pdf"
rename_file "$TAXES_DIR/2022/income/w2/OPEN3-US_W-2_7757616924668427.pdf" \
            "$TAXES_DIR/2022/income/w2/Open3_W2_2022.pdf"

# 2023 W-2s
rename_file "$TAXES_DIR/2023/income/w2/Form_W-2_Tax_Year_2023.pdf" \
            "$TAXES_DIR/2023/income/w2/Coinmine_W2_2023.pdf"
rename_file "$TAXES_DIR/2023/income/w2/US_W-2_7757616924668427.pdf" \
            "$TAXES_DIR/2023/income/w2/Open3_W2_2023.pdf"

# 2024 W-2s
rename_file "$TAXES_DIR/2024/income/w2/Ford Adam W-2 2024.pdf" \
            "$TAXES_DIR/2024/income/w2/Ford_W2_Adam_2024.pdf"
rename_file "$TAXES_DIR/2024/income/w2/Coinmine Form_W-2_Tax_Year_2024.pdf" \
            "$TAXES_DIR/2024/income/w2/Coinmine_W2_2024.pdf"
rename_file "$TAXES_DIR/2024/income/w2/Angela W-2 2024.pdf" \
            "$TAXES_DIR/2024/income/w2/Ford_W2_Angela_2024.pdf"

# 2020 W-2
rename_file "$TAXES_DIR/2020/income/w2/Form_W-2_Tax_Year_2020.pdf" \
            "$TAXES_DIR/2020/income/w2/Coinmine_W2_2020.pdf"

# 2018 W-2s
rename_file "$TAXES_DIR/2018/income/w2/Form_W-2_Tax_Year_2018.pdf" \
            "$TAXES_DIR/2018/income/w2/Coinmine_W2_2018.pdf"
rename_file "$TAXES_DIR/2018/income/w2/mtsu.pdf" \
            "$TAXES_DIR/2018/income/w2/MTSU_W2_2018.pdf"

# 2015-2017 W-2s
rename_file "$TAXES_DIR/2015/income/w2/2015 - MTSU - W2.png" \
            "$TAXES_DIR/2015/income/w2/MTSU_W2_2015.png"
rename_file "$TAXES_DIR/2016/income/w2/2016 - MTSU - W2.png" \
            "$TAXES_DIR/2016/income/w2/MTSU_W2_2016.png"
rename_file "$TAXES_DIR/2017/income/w2/2017 - MTSU - W2.png" \
            "$TAXES_DIR/2017/income/w2/MTSU_W2_2017.png"

# --- 1099s ---
echo ""
echo "--- 1099 Forms ---"

# 2022 1099s
rename_file "$TAXES_DIR/2022/income/1099/OPEN3-US_1099_2022.pdf" \
            "$TAXES_DIR/2022/income/1099/Open3_1099-nec_2022.pdf"
rename_file "$TAXES_DIR/2022/income/1099/AltoIRA-40484-2022-form_1099-R-356.pdf" \
            "$TAXES_DIR/2022/income/1099/Alto_IRA_1099-r_2022.pdf"
rename_file "$TAXES_DIR/2022/income/1099/Robinhood Markets Consolidated Form 1099.pdf" \
            "$TAXES_DIR/2022/income/1099/Robinhood_1099-b_2022.pdf"

# 2024 1099s
rename_file "$TAXES_DIR/2024/income/1099/Vanguard 1099R.pdf" \
            "$TAXES_DIR/2024/income/1099/Vanguard_1099-r_2024.pdf"
rename_file "$TAXES_DIR/2024/income/1099/Vanguard 1099.pdf" \
            "$TAXES_DIR/2024/income/1099/Vanguard_1099-div_2024.pdf"
rename_file "$TAXES_DIR/2024/income/1099/Form 1099-NEC (Rev. January 2024) - f1099nec-adam.pdf" \
            "$TAXES_DIR/2024/income/1099/Teraflop_1099-nec_2024.pdf"
rename_file "$TAXES_DIR/2024/income/1099/Vanguard Angela 1099R.pdf" \
            "$TAXES_DIR/2024/income/1099/Vanguard_1099-r_Angela_2024.pdf"

# 2021 1099s
rename_file "$TAXES_DIR/2021/income/1099/AltoIRA-40484-2021-form_5498-2701.pdf" \
            "$TAXES_DIR/2021/income/1099/Alto_IRA_5498_2021.pdf"

# 2020 1099s
rename_file "$TAXES_DIR/2020/income/1099/my benefit wallet hsa 1099-SA.pdf" \
            "$TAXES_DIR/2020/income/1099/Benefit_Wallet_1099-sa_2020.pdf"
rename_file "$TAXES_DIR/2020/income/1099/1099-NEC_from_FunFunFun_Inc_.pdf" \
            "$TAXES_DIR/2020/income/1099/FunFunFun_1099-nec_2020.pdf"

# 2018 1099s
rename_file "$TAXES_DIR/2018/income/1099/1099-MISC.pdf" \
            "$TAXES_DIR/2018/income/1099/Unknown_1099-misc_2018.pdf"
rename_file "$TAXES_DIR/2018/income/1099/1099-MISC(1).pdf" \
            "$TAXES_DIR/2018/income/1099/Unknown_1099-misc_2_2018.pdf"

# --- Returns ---
echo ""
echo "--- Tax Returns ---"

rename_file "$TAXES_DIR/2014/returns/TaxReturn.pdf" \
            "$TAXES_DIR/2014/returns/Return_filed_2014.pdf"
rename_file "$TAXES_DIR/2010/returns/TaxReturn.pdf" \
            "$TAXES_DIR/2010/returns/Return_filed_2010.pdf"
rename_file "$TAXES_DIR/2022/returns/ADAM MISCHKE 22.pdf" \
            "$TAXES_DIR/2022/returns/Return_filed_2022.pdf"
rename_file "$TAXES_DIR/2022/returns/amended.pdf" \
            "$TAXES_DIR/2022/returns/Return_amended_2022.pdf"
rename_file "$TAXES_DIR/2023/returns/ADAM MISCHKE 23.pdf" \
            "$TAXES_DIR/2023/returns/Return_filed_2023.pdf"
rename_file "$TAXES_DIR/2024/returns/2024-final.pdf" \
            "$TAXES_DIR/2024/returns/Return_filed_2024.pdf"
rename_file "$TAXES_DIR/2021/returns/taxes-2021.pdf" \
            "$TAXES_DIR/2021/returns/Return_filed_2021.pdf"
rename_file "$TAXES_DIR/2020/returns/Adam and Angela 2020.pdf" \
            "$TAXES_DIR/2020/returns/Return_filed_2020.pdf"

# --- Crypto ---
echo ""
echo "--- Crypto Reports ---"

rename_file "$TAXES_DIR/2022/crypto/webull.pdf" \
            "$TAXES_DIR/2022/crypto/Webull_Crypto_2022.pdf"
rename_file "$TAXES_DIR/2018/crypto/IRS Form 8949.pdf" \
            "$TAXES_DIR/2018/crypto/Form_8949_2018.pdf"
rename_file "$TAXES_DIR/2018/crypto/IRS Form 8949(1).pdf" \
            "$TAXES_DIR/2018/crypto/Form_8949_2_2018.pdf"

# --- Other/HSA ---
echo ""
echo "--- Other Documents ---"

rename_file "$TAXES_DIR/2020/income/other/my benefit wallet hsa 5498-SA .pdf" \
            "$TAXES_DIR/2020/income/other/Benefit_Wallet_5498-sa_2020.pdf"
rename_file "$TAXES_DIR/2018/income/other/hsa.pdf" \
            "$TAXES_DIR/2018/income/other/HSA_2018.pdf"

echo ""
echo "=========================================="
echo "AM2 LLC DOCUMENTS"
echo "=========================================="

# --- 1099s ---
echo ""
echo "--- 1099 Forms ---"

rename_file "$AM2_DIR/2025/income/1099/Art-City-1099-NEC_2025.pdf" \
            "$AM2_DIR/2025/income/1099/Art_City_1099-nec_2025.pdf"
rename_file "$AM2_DIR/2025/income/1099/2025_1099_NEC_from_Science_Partners_Management_LLC.pdf" \
            "$AM2_DIR/2025/income/1099/Science_Partners_1099-nec_2025.pdf"

# Also in 1099s folder (duplicates)
rename_file "$AM2_DIR/1099s/2025/Art-City-1099-NEC_2025.pdf" \
            "$AM2_DIR/1099s/2025/Art_City_1099-nec_2025.pdf"
rename_file "$AM2_DIR/1099s/2025/2025_1099_NEC_from_Science_Partners_Management_LLC.pdf" \
            "$AM2_DIR/1099s/2025/Science_Partners_1099-nec_2025.pdf"

# --- Teraflop Invoices ---
echo ""
echo "--- Teraflop Invoices ---"

rename_file "$AM2_DIR/Teraflop/Invoices/Teraflop Invoice - January 2026.pdf" \
            "$AM2_DIR/Teraflop/Invoices/Teraflop_Invoice_2026-01.pdf"
rename_file "$AM2_DIR/Teraflop/Invoices/Teraflop Invoice - December 2025.pdf" \
            "$AM2_DIR/Teraflop/Invoices/Teraflop_Invoice_2025-12.pdf"
rename_file "$AM2_DIR/Teraflop/Invoices/Teraflop Invoice - November 2025.pdf" \
            "$AM2_DIR/Teraflop/Invoices/Teraflop_Invoice_2025-11.pdf"
rename_file "$AM2_DIR/Teraflop/Invoices/Teraflop Invoice - October 2025.pdf" \
            "$AM2_DIR/Teraflop/Invoices/Teraflop_Invoice_2025-10.pdf"
rename_file "$AM2_DIR/Teraflop/Invoices/Teraflop Invoice - September 2025.pdf" \
            "$AM2_DIR/Teraflop/Invoices/Teraflop_Invoice_2025-09.pdf"
rename_file "$AM2_DIR/Teraflop/Invoices/Teraflop Invoice - August - 2025.pdf" \
            "$AM2_DIR/Teraflop/Invoices/Teraflop_Invoice_2025-08.pdf"
rename_file "$AM2_DIR/Teraflop/Invoices/Teraflop Invoice - July 2025.pdf" \
            "$AM2_DIR/Teraflop/Invoices/Teraflop_Invoice_2025-07.pdf"
rename_file "$AM2_DIR/Teraflop/Invoices/Teraflop Invoice - July - Updated 2025.pdf" \
            "$AM2_DIR/Teraflop/Invoices/Teraflop_Invoice_updated_2025-07.pdf"
rename_file "$AM2_DIR/Teraflop/Invoices/Teraflop Invoice - June 2025.pdf" \
            "$AM2_DIR/Teraflop/Invoices/Teraflop_Invoice_2025-06.pdf"
rename_file "$AM2_DIR/Teraflop/Invoices/Teraflop Invoice - May 2025.pdf" \
            "$AM2_DIR/Teraflop/Invoices/Teraflop_Invoice_2025-05.pdf"
rename_file "$AM2_DIR/Teraflop/Invoices/Teraflop Invoice - February 2025.pdf" \
            "$AM2_DIR/Teraflop/Invoices/Teraflop_Invoice_2025-02.pdf"
rename_file "$AM2_DIR/Teraflop/Invoices/Teraflop Invoice - January 2025.pdf" \
            "$AM2_DIR/Teraflop/Invoices/Teraflop_Invoice_2025-01.pdf"
rename_file "$AM2_DIR/Teraflop/Invoices/Teraflop Invoice - December 2024.pdf" \
            "$AM2_DIR/Teraflop/Invoices/Teraflop_Invoice_2024-12.pdf"
rename_file "$AM2_DIR/Teraflop/Invoices/Teraflop Invoice - November 2024.pdf" \
            "$AM2_DIR/Teraflop/Invoices/Teraflop_Invoice_2024-11.pdf"
rename_file "$AM2_DIR/Teraflop/Invoices/Teraflop Invoice - October 2024.pdf" \
            "$AM2_DIR/Teraflop/Invoices/Teraflop_Invoice_2024-10.pdf"

# --- Science Invoices ---
echo ""
echo "--- Science Invoices ---"

rename_file "$AM2_DIR/Science/Invoices/Science Invoice - January 2026.pdf" \
            "$AM2_DIR/Science/Invoices/Science_Invoice_2026-01.pdf"
rename_file "$AM2_DIR/Science/Invoices/Science Invoice - December 2025.pdf" \
            "$AM2_DIR/Science/Invoices/Science_Invoice_2025-12.pdf"
rename_file "$AM2_DIR/Science/Invoices/Science Invoice - November 2025.pdf" \
            "$AM2_DIR/Science/Invoices/Science_Invoice_2025-11.pdf"
rename_file "$AM2_DIR/Science/Invoices/Science Invoice - October 2025.pdf" \
            "$AM2_DIR/Science/Invoices/Science_Invoice_2025-10.pdf"
rename_file "$AM2_DIR/Science/Invoices/Science Invoice - August:September 2025.pdf" \
            "$AM2_DIR/Science/Invoices/Science_Invoice_2025-08-09.pdf"

# --- Art Department Invoice ---
echo ""
echo "--- Art Department Invoice ---"

rename_file "$AM2_DIR/Art Department/Invoices/Art Department Invoice - October 2025.pdf" \
            "$AM2_DIR/Art Department/Invoices/Art_Department_Invoice_2025-10.pdf"

# --- Teraflop Contracts ---
echo ""
echo "--- Contracts ---"

rename_file "$AM2_DIR/Teraflop/Independent Contractor Agreement Signed.pdf" \
            "$AM2_DIR/Teraflop/Teraflop_Contractor_Agreement.pdf"
rename_file "$AM2_DIR/Teraflop/w9-2024.pdf" \
            "$AM2_DIR/Teraflop/Teraflop_W9_2024.pdf"
rename_file "$AM2_DIR/Teraflop/Form 1099-NEC (Rev. January 2024) - f1099nec-adam.pdf" \
            "$AM2_DIR/Teraflop/Teraflop_1099-nec_2024.pdf"

rename_file "$AM2_DIR/Science/W9.pdf" \
            "$AM2_DIR/Science/Science_W9.pdf"
rename_file "$AM2_DIR/Science/Contract/Science_Vita_Venture_-_Consulting_Agreement_-_AM2_LLC.pdf" \
            "$AM2_DIR/Science/Contract/Science_Contractor_Agreement.pdf"

# --- Business Docs ---
echo ""
echo "--- Business Documents ---"

rename_file "$AM2_DIR/business-docs/ein/CP575Notice_1705420211786.pdf" \
            "$AM2_DIR/business-docs/ein/EIN_Letter.pdf"
rename_file "$AM2_DIR/business-docs/formation/ArticlesofOrganization.pdf" \
            "$AM2_DIR/business-docs/formation/Articles_of_Organization.pdf"
rename_file "$AM2_DIR/business-docs/formation/ArticlesofOrganizationAcknowledge.pdf" \
            "$AM2_DIR/business-docs/formation/Articles_of_Organization_Acknowledgement.pdf"
rename_file "$AM2_DIR/business-docs/formation/CertOfAuthExist.pdf" \
            "$AM2_DIR/business-docs/formation/Certificate_of_Authority.pdf"

# --- Receipts ---
echo ""
echo "--- Receipts ---"

rename_file "$AM2_DIR/Receipts/2025/15AUG2025 – Extended workday meal – client feature deployment.jpeg" \
            "$AM2_DIR/Receipts/2025/Restaurant_meals_Client-deployment_2025-08-15.jpeg"
rename_file "$AM2_DIR/Receipts/2025/29AUG2025 – Extended workday meal – new client & farm.jpeg" \
            "$AM2_DIR/Receipts/2025/Restaurant_meals_Client-meeting_2025-08-29.jpeg"
rename_file "$AM2_DIR/Receipts/2025/watch-receipt.pdf" \
            "$AM2_DIR/Receipts/2025/Apple_equipment_Watch_2025.pdf"
rename_file "$AM2_DIR/Receipts/2025/iphone-receipt.pdf" \
            "$AM2_DIR/Receipts/2025/Apple_equipment_iPhone_2025.pdf"
rename_file "$AM2_DIR/Receipts/2025/Proton Mail invoice 8143500.pdf" \
            "$AM2_DIR/Receipts/2025/Proton_software_Email_2025.pdf"
rename_file "$AM2_DIR/Receipts/2025/Squarespace-am2biz-2025.pdf" \
            "$AM2_DIR/Receipts/2025/Squarespace_software_AM2-website_2025.pdf"
rename_file "$AM2_DIR/Receipts/2025/Squarespace-catwebm-2025.pdf" \
            "$AM2_DIR/Receipts/2025/Squarespace_software_Catwebm_2025.pdf"

rename_file "$AM2_DIR/Receipts/2024/OpenAI LLC Invoice 73366834.pdf" \
            "$AM2_DIR/Receipts/2024/OpenAI_software_API_2024.pdf"
rename_file "$AM2_DIR/Receipts/2024/OpenAI LLC Invoice AB8C668F.pdf" \
            "$AM2_DIR/Receipts/2024/OpenAI_software_API_2_2024.pdf"
rename_file "$AM2_DIR/Receipts/2024/OpenAI LLC Invoice AB8C668F (1).pdf" \
            "$AM2_DIR/Receipts/2024/OpenAI_software_API_3_2024.pdf"
rename_file "$AM2_DIR/Receipts/2024/OpenAI LLC Invoice AB8C668F (2).pdf" \
            "$AM2_DIR/Receipts/2024/OpenAI_software_API_4_2024.pdf"
rename_file "$AM2_DIR/Receipts/2024/Proton Mail Invoice.pdf" \
            "$AM2_DIR/Receipts/2024/Proton_software_Email_2024.pdf"
rename_file "$AM2_DIR/Receipts/2024/Anthropic Invoice.pdf" \
            "$AM2_DIR/Receipts/2024/Anthropic_software_API_2024.pdf"

echo ""
echo "=========================================="
echo "MANNA OF THE VALLEY LLC DOCUMENTS"
echo "=========================================="

# --- Business Docs ---
echo ""
echo "--- Business Documents ---"

rename_file "$MANNA_DIR/business-docs/ein/CP_575_B Notice - CP_575_B.pdf" \
            "$MANNA_DIR/business-docs/ein/EIN_Letter.pdf"
rename_file "$MANNA_DIR/business-docs/formation/TN SOS Generated Document - FormFiling.pdf" \
            "$MANNA_DIR/business-docs/formation/Articles_of_Organization.pdf"
rename_file "$MANNA_DIR/business-docs/formation/Manna Of The Valley Llc — Operating Agreement & Initial Resolutions (draft).pdf" \
            "$MANNA_DIR/business-docs/formation/Operating_Agreement_draft.pdf"
rename_file "$MANNA_DIR/business-docs/licenses/SalesExemptReceipt.pdf" \
            "$MANNA_DIR/business-docs/licenses/Sales_Tax_Exemption.pdf"
rename_file "$MANNA_DIR/business-docs/licenses/FVC Membership Card - 003Ro00000gHfo9.pdf" \
            "$MANNA_DIR/business-docs/licenses/FVC_Membership.pdf"

# --- Receipts ---
echo ""
echo "--- Receipts ---"

rename_file "$MANNA_DIR/Receipts/2025/Water & Road.pdf" \
            "$MANNA_DIR/Receipts/2025/Utility_Water-Road_2025.pdf"
rename_file "$MANNA_DIR/Receipts/2025/Water turn on-9-25-25-77-95.pdf" \
            "$MANNA_DIR/Receipts/2025/Utility_Water-turnon_2025-09-25.pdf"
rename_file "$MANNA_DIR/Receipts/2025/Checks-9-30-2025-112-42.pdf" \
            "$MANNA_DIR/Receipts/2025/Bank_Checks_2025-09-30.pdf"
rename_file "$MANNA_DIR/Receipts/2025/SolarGate-1.pdf" \
            "$MANNA_DIR/Receipts/2025/Solar_equipment_Gate-1_2025.pdf"
rename_file "$MANNA_DIR/Receipts/2025/Solar-Gate-2.pdf" \
            "$MANNA_DIR/Receipts/2025/Solar_equipment_Gate-2_2025.pdf"
rename_file "$MANNA_DIR/Receipts/2025/Kubota_Credit_Corporation_Contract.pdf" \
            "$MANNA_DIR/Receipts/2025/Kubota_equipment_Tractor-contract_2025.pdf"
rename_file "$MANNA_DIR/Receipts/2025/Updated_Kubota_Credit_Corporation_Contract.pdf" \
            "$MANNA_DIR/Receipts/2025/Kubota_equipment_Tractor-contract-updated_2025.pdf"
rename_file "$MANNA_DIR/Receipts/2025/Kubota Credit App.pdf" \
            "$MANNA_DIR/Receipts/2025/Kubota_equipment_Credit-application_2025.pdf"

# --- Quotes ---
echo ""
echo "--- Quotes ---"

rename_file "$MANNA_DIR/Quotes/Kubota - Adam Mischke - M7060HDC.pdf" \
            "$MANNA_DIR/Quotes/Kubota_Quote_M7060HDC.pdf"

echo ""
echo "=========================================="
echo "DONE"
echo "=========================================="
