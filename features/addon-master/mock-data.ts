import type { MasterField } from "../masters/types";
import type { AddonField, AddonRecord } from "./types";

export const addonFields: AddonField[] = [
  ["name", "* NAME"], ["shortName", "SHORT NAME"], ["openingBalance", "OPENING BALANCE"], ["margin", "MARGIN"],
  ["address1", "ADDRESS1"], ["address2", "ADDRESS2"], ["address3", "ADDRESS3"], ["city", "CITY"],
  ["pincode", "PINCODE NO."], ["district", "DISTRICT"], ["remark", "REMARK"], ["contact", "CONTACT"],
  ["telephone", "TELEPHONE NO"], ["mobile", "MOBILE NO"], ["fax", "FAX NO"], ["localCode", "LOCAL CODE"],
  ["stdCode", "STD CODE"], ["pan", "PAN NO"], ["aadhaar", "AADHAAR NO"], ["vat", "VAT NO"], ["cst", "CST NO"],
  ["gst", "GST NO"], ["state", "E-STATE"], ["email", "E-MAIL ADD"], ["website", "WEB SITE"],
  ["startDate", "START DATE"], ["lastDate", "LAST DATE"],
].map(([key, label]) => ({ key: key as keyof AddonRecord, label, required: key === "name", help: key === "state" ? "state" : undefined }));
export const stateOptions = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh",
  "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep",
  "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry",
  "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
  "West Bengal",
];
/**
 * The same fields again, told to the shared Update/Delete grid.
 *
 * It is DERIVED from addonFields rather than written out a second time, because the
 * form's row order and the grid's column order have to stay one list: the shared master
 * form addresses its rows by position, so a column that drifted out of step here would
 * point the form at the wrong field.
 *
 * Only the traits the grid cannot infer are added - what may not be typed over, what has
 * to parse as a number, and what comes from a closed list.
 */
export const addonGridFields: MasterField<AddonRecord>[] = addonFields.map((field) => ({
  key: field.key as Extract<keyof AddonRecord, string>,
  label: field.label,
  required: field.required,
  // Both dates are stored as timestamps; until the grid has a date editor they are
  // changed on the form, where the value is parsed properly.
  readOnly: field.key === "startDate" || field.key === "lastDate",
  numeric: field.key === "margin" || field.key === "openingBalance",
  options: field.key === "state" ? stateOptions : undefined,
  width: field.key === "name" ? 210 : undefined,
}));

/**
 * The column each grid field is stored in.
 *
 * smart_setup.program_body describes a master by its table columns, so this is what lets
 * the setup read from there be matched to the record keys the web app uses. It mirrors
 * the SELECT in lib/addon-master.ts - if a column is renamed there, it changes here too.
 */
export const addonColumnOf: Partial<Record<keyof AddonRecord, string>> = {
  name: "sub_name", shortName: "short_name", openingBalance: "sub_opening", margin: "profit_margin",
  address1: "address_1", address2: "address_2", address3: "address_3", city: "city",
  pincode: "pin_code", district: "district", remark: "add_remark", contact: "contact",
  telephone: "tel_no", mobile: "mobile_no", fax: "fax", localCode: "local_code",
  stdCode: "std_code", pan: "pan_no", aadhaar: "aadhar_no", vat: "lst_no", cst: "cst_no",
  gst: "gst_no", state: "state_id", email: "e_mail", website: "website",
  startDate: "sub_startdt", lastDate: "sub_lastdt",
};

export const createBlankAddon = (id: number, groupId: number): AddonRecord => ({ id, groupId, name: "", shortName: "", openingBalance: "", margin: "", address1: "", address2: "", address3: "", city: "", pincode: "", district: "", remark: "", contact: "", telephone: "", mobile: "", fax: "", localCode: "", stdCode: "", pan: "", aadhaar: "", vat: "", cst: "", gst: "", state: "", email: "", website: "", startDate: "", lastDate: "" });
