import api from "@flatfile/api";
import { jobHandler } from "@flatfile/plugin-job-handler";
import { Simplified } from "@flatfile/util-common";
import * as chrono from "chrono-node";
import { format } from "date-fns";
import { enUS } from "date-fns/locale";
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

      const date = record.date as string;
      const finished = record.finished as string;
      const createdAt = record.createdAt as string;

      if (!createdAt && date) {
        const endTime = record.endTime as string;
        const normalizedDate = normalizeDate(date);
        if (normalizedDate) {
          // Extract just the date portion from normalized date
          // Use endTime if available, otherwise use 00:00
          const timePart = endTime || "00:00";
          newRecord["date"] = `${normalizedDate} ${timePart}`;
          newRecord["createdAt"] = `${normalizedDate} ${timePart}`;
          newRecord["endTime"] = `${normalizedDate} ${timePart}`;
          updateRecord = true;
        }
      }

      if (finished) {
        const normalizedFinished = normalizeFinishedDate(finished);
        if (normalizedFinished) {
          newRecord["finished"] = normalizedFinished;
          updateRecord = true;
        }
      }

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

export interface DateFormatNormalizerConfig {
  sheetSlug?: string;
  dateFields: string[];
  outputFormat: string;
  includeTime: boolean;
  locale?: string;
}

export function normalizeDate(dateString: string): string | null {
  try {
    const parsedDate = chrono.parseDate(dateString);
    if (parsedDate) {
      const formattedDate = format(parsedDate, "M/d/yy", {
        locale: enUS,
      });

      // If time should not be included, truncate the formatted date to just the date part
      return formattedDate.split(" ")[0];
    }
    return null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

export function normalizeFinishedDate(dateString: string): string | null {
  try {
    const parsedDate = chrono.parseDate(dateString);
    if (parsedDate) {
      const formattedDate = format(parsedDate, "yyyy-MM-dd hh:mma", {
        locale: enUS,
      }).toLowerCase();

      return formattedDate;
    }
    return null;
  } catch (error) {
    console.error(error);
    return null;
  }
}
