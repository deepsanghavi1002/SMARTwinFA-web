/**
 * Column and field headings are shown in one style whatever case the setup stores them in:
 * Proper Case, the first letter of every word capital and the rest small ("OPENING BALANCE",
 * "opening balance" and "Opening balance" all show as "Opening Balance"). Underscores in a raw
 * field name become spaces ("SR_NO" shows "Sr No"). Short forms that are read letter by letter
 * stay in capitals ("GST No.", "PAN", "IFSC Code"); add to SHORT_FORMS when a new one turns up.
 */

const SHORT_FORMS = new Set([
  "GST", "GSTIN", "CGST", "SGST", "IGST", "UTGST", "VAT", "CST", "TIN", "PAN", "TAN", "CIN", "LLPIN",
  "TDS", "TCS", "HSN", "SAC", "IFSC", "MICR", "RTGS", "NEFT", "UPI", "MSME", "FSSAI", "IEC",
  "UOM", "MRP", "EAN", "SKU", "PIN", "ID", "KYC", "SMS", "OTP", "URL", "QR", "POS", "PO", "DC", "GRN", "LR", "DOB",
]);

export function properHeading(text: string): string {
  return text
    .replace(/_/g, " ")
    .replace(/[A-Za-z]+/g, (word) => (SHORT_FORMS.has(word.toUpperCase()) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()));
}
