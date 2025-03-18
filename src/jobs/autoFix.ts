import api from "@flatfile/api";
import { jobHandler } from "@flatfile/plugin-job-handler";
import { Simplified } from "@flatfile/util-common";
const leaveBlankFields = [
  "travelDuration",
  "onJobDuration",
  "totalDuration",
  "email",
  "company",
  "mobilePhone",
  "homePhone",
  "customerTags",
  "address",
  "paymentHistory",
  "creditCardFee",
  "taxRate",
  "payment",
  "invoiceSent",
  "window",
  "attachments",
  "segments",
  "hcJob",
  "tipAmount",
  "onlineBookingSource",
];
const mustBeZeroFeilds = [
  "labor",
  "materials",
  "discount",
  "tax",
  "taxableAmount",
];

export default jobHandler("sheet:auto-fix", async ({ context }, tick) => {
  const { jobId, sheetId } = context;

  try {
    const updates = [];
    const delete_ids = [];

    const records = await Simplified.getAllRecords(sheetId);

    records.forEach((record) => {
      const newRecord: Record<string, any> = { _id: record._id };
      let updateRecord = false;

      leaveBlankFields.forEach((field) => {
        if (record[field] !== "") {
          newRecord[field] = null;
          updateRecord = true;
        }
      });

      mustBeZeroFeilds.forEach((field) => {
        if (record[field] !== 0) {
          newRecord[field] = 0;
          updateRecord = true;
        }
      });

      if (updateRecord) {
        updates.push(newRecord);
      }
    });
    await Simplified.updateAllRecords(sheetId, updates as any);
    if (delete_ids.length > 0) {
      await api.records.delete(sheetId, { ids: delete_ids });
    }
    await api.jobs.complete(jobId, { info: "Completed processing records" });
  } catch (error) {
    await api.jobs.fail(jobId, { info: "Failed processing records" });
  }
});