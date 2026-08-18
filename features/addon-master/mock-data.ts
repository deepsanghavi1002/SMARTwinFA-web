import type { AddonField, AddonGroup, AddonRecord } from "./types";

export const addonGroups: AddonGroup[] = ["Architect", "Area", "Group", "Location", "Main Location", "Prod Group", "Sales Man", "Sub Ledger"].map((name) => ({ id: name.toLowerCase().replaceAll(" ", "-"), name }));
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
export const createBlankAddon = (id: number, groupId: string): AddonRecord => ({ id, groupId, name: "", shortName: "", openingBalance: "", margin: "", address1: "", address2: "", address3: "", city: "", pincode: "", district: "", remark: "", contact: "", telephone: "", mobile: "", fax: "", localCode: "", stdCode: "", pan: "", aadhaar: "", vat: "", cst: "", gst: "", state: "", email: "", website: "", startDate: "", lastDate: "" });
export const initialAddonRecords: AddonRecord[] = [
  { ...createBlankAddon(1, "architect"), name: "ABHISEK GUPTA", shortName: "AG", city: "Kolkata", state: "West Bengal", mobile: "9830012345" },
  { ...createBlankAddon(2, "architect"), name: "ARHITEK RAI", shortName: "AR", city: "Kolkata", state: "West Bengal", mobile: "9831012345" },
  { ...createBlankAddon(3, "architect"), name: "NONE", shortName: "NONE" },
  { ...createBlankAddon(4, "area"), name: "KOLKATA", shortName: "KOL" },
  { ...createBlankAddon(5, "location"), name: "SALT LAKE", shortName: "SL" },
];
