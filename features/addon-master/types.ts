export type AddonGroup = { id: number; name: string; short?: string; rows?: number };
export type AddonRecord = {
  id: number; groupId: number; name: string; shortName: string; openingBalance: string; margin: string;
  address1: string; address2: string; address3: string; city: string; pincode: string; district: string;
  remark: string; contact: string; telephone: string; mobile: string; fax: string; localCode: string;
  stdCode: string; pan: string; aadhaar: string; vat: string; cst: string; gst: string; state: string;
  email: string; website: string; startDate: string; lastDate: string;
};
export type AddonField = { key: keyof AddonRecord; label: string; required?: boolean; help?: "state" };
