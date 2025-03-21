import FlatfileListener from "@flatfile/listener";
import { FlatfileRecord, bulkRecordHook } from "@flatfile/plugin-record-hook";
import { configureSpace } from "@flatfile/plugin-space-configure";
import { xlsxExtractorPlugin } from "@flatfile/plugin-xlsx-extractor";
import { addresses, customers, invoices } from "./blueprints/sheets";
import autoFix from "./jobs/autoFix";
import generateCustIds from "./jobs/generateCustIds";
import getAddresses from "./jobs/getAddresses";
import mergeRecords from "./jobs/mergeRecords";
import { TransposeColumns, transposeHook } from "./jobs/transpose";
import { TransposeExecute } from "./jobs/transpose-execute";
import { MergeWorker } from "./support/dedupe-records";
import { ExportXlsxWorker } from "./support/export-xlsx.worker";
import { instrumentRequests } from "./support/instrument.requests";
import "./support/requests/records/global.collect.macros";
import { worker } from "./support/utils/job.worker";
import { generateIdsPlugin, GenerateIdsJob } from "./jobs/preProGenerateIds";
import * as chrono from "chrono-node";
import { format } from "date-fns";
import { enUS } from "date-fns/locale";

instrumentRequests();

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

// Helper function to normalize date to M/d/yy HH:mm format
function normalizeDateWithTime(dateString: string): string | null {
  try {
    const parsedDate = chrono.parseDate(dateString);
    if (parsedDate) {
      // Format with time in 24-hour format
      return format(parsedDate, "M/d/yy HH:mm", {
        locale: enUS,
      });
    }
    return null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

// Helper function to normalize finished date to yyyy-mm-dd hh:mmam/pm format
function normalizeFinishedDate(dateString: string): string | null {
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

export default function (listener: FlatfileListener) {
  listener.use(xlsxExtractorPlugin());
  listener.use(worker(MergeWorker));
  listener.use(worker(ExportXlsxWorker));

  listener.use(transposeHook);
  listener.use(worker(TransposeColumns));
  listener.use(worker(TransposeExecute));

  listener.use(worker(GenerateIdsJob));
  listener.use(generateIdsPlugin());

  listener.use(
    configureSpace({
      workbooks: [
        {
          name: "Sera Workbook",
          sheets: [customers, addresses, invoices],
          actions: [
            {
              operation: "export-xlsx",
              mode: "foreground",
              label: "Download",
              primary: true,
            },
          ],
        },
      ],
      space: {
        metadata: {
          theme: {
            root: {
              primaryColor: "#246dff",
              actionColor: "#246dff",
            },
            sidebar: {
              logo: "https://sera.tech/hubfs/web-ready/brand/logos/logo-full-color.svg",
            },
          },
        },
      },
    })
  );

  listener.use(autoFix);
  listener.use(getAddresses);
  listener.use(generateCustIds);
  listener.use(mergeRecords);

  listener.use(
    bulkRecordHook("addresses", (records: FlatfileRecord[]) => {
      records.map((record) => {
        const isBilling = record.get("isBilling");

        if (typeof isBilling === "string") {
          if (isBilling.toLowerCase() === "billing") {
            record.set("isBilling", true);
          } else {
            record.set("isBilling", null);
          }
        }

        if (!record.get("customerId")) {
          // Try to match customerId based on displayName
          const matchedIDFromDisplayName =
            record.getLinks("refDisplayName")[0]?.["id"];

          if (matchedIDFromDisplayName) {
            record.set("customerId", matchedIDFromDisplayName);
          }
        }

        return record;
      });
    })
  );

  listener.use(
    bulkRecordHook("customers", (records: FlatfileRecord[]) => {
      records.map((record) => {
        // Handle display name and name splitting
        const displayName = record.get("displayName") as string;
        if (displayName) {
          const trimmedName = displayName.trim();
          record.set("displayName", trimmedName);
          const nameParts = trimmedName.split(" ");
          if (nameParts.length > 0) {
            record.set("firstName", nameParts[0]);
            if (nameParts.length > 1) {
              record.set("lastName", nameParts.slice(1).join(" "));
            }
          }
        }

        // Handle phone numbers
        const mobileNumber = record.get("mobileNumber") as string;
        console.log({ mobileNumber });
        if (mobileNumber) {
          // Split by comma and map to array of phone numbers or null
          const phoneNumbers = mobileNumber
            .split(",")
            .map((num) => {
              const trimmed = num.trim();
              return trimmed && trimmed !== "," ? trimmed : null;
            })
            .filter((num) => num !== undefined); // Keep null values but remove undefined

          // Find first two available numbers
          const validNumbers = phoneNumbers.filter((num) => num !== null);

          if (validNumbers.length > 0) {
            record.set("mobileNumber", validNumbers[0]);
            if (validNumbers.length > 1) {
              record.set("homeNumber", validNumbers[1]);
            }
          } else {
            record.set("mobileNumber", null);
          }
        }

        return record;
      });
    })
  );

  listener.use(
    bulkRecordHook("invoices", (records: FlatfileRecord[]) => {
      records.map((record) => {
        const createdAt = record.get("createdAt") as string;
        const date = record.get("date") as string;
        const finishedAt = record.get("finished") as string;
        const customerName = record.get("customer") as string;
        const invoiceValue = record.get("invoice");
        const amount = record.get("amount");
        const paidAmount = record.get("paidAmount");
        const dateRegex = /([0-9]+\/[0-9]+\/[0-9][0-9] [0-2][0-9]:[0-5][0-9]$)/;
        const finishedRegex =
          /([0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-1][0-9]:[0-5][0-9](?:am|pm)$)/i;

        // Copy invoice value to hcpId if it exists
        if (invoiceValue) {
          record.set("hcpId", invoiceValue);
        }

        // Copy amount to subtotal if amount exists
        if (amount) {
          record.set("subtotal", amount);
        }

        // Handle paidAmount field
        if (paidAmount === "Paid" && amount) {
          record.set("paidAmount", amount);
        } else if (paidAmount === "Unpaid" && amount) {
          record.set("due", amount);
          record.set("paidAmount", 0);
        }

        // Handle display name and name splitting
        if (customerName) {
          const trimmedName = customerName.trim();
          record.set("customer", trimmedName);
          const nameParts = trimmedName.split(" ");
          if (nameParts.length > 0) {
            record.set("firstName", nameParts[0]);
            if (nameParts.length > 1) {
              record.set("lastName", nameParts.slice(1).join(" "));
            }
          }
        }

        // Transform createdAt to correct format and copy to date and endTime
        if (createdAt) {
          if (!dateRegex.test(createdAt)) {
            const normalizedCreatedAt = normalizeDateWithTime(createdAt);
            if (normalizedCreatedAt) {
              record.set("createdAt", normalizedCreatedAt);
              record.set("date", normalizedCreatedAt);
              record.set("endTime", normalizedCreatedAt);
            } else {
              record.addError("createdAt", `Must be in M/d/yy HH:mm format`);
            }
          } else {
            // If createdAt is already in the correct format, still copy to date and endTime
            record.set("date", createdAt);
            record.set("endTime", createdAt);
          }
          if (!finishedRegex.test(finishedAt)) {
            const normalizedFinished = normalizeFinishedDate(createdAt);
            if (normalizedFinished) {
              record.set("finished", normalizedFinished);
            } else {
              record.addError(
                "finished",
                `Must be in yyyy-mm-dd hh:mmam/pm format`
              );
            }
          }
        }
        // Only check date format if createdAt wasn't processed (to avoid duplicate errors)
        else if (date) {
          if (!dateRegex.test(date)) {
            record.addError("date", `Must be in M/d/yy HH:mm format`);
          }
        }

        for (const field of leaveBlankFields) {
          if (record.get(field) as string) {
            record.set(field, null);
          }
        }

        for (const field of mustBeZeroFeilds) {
          if (record.get(field) !== 0 && record.get(field) !== "0") {
            record.set(field, 0);
          }
        }

        const referenceFieldKey = "customer";
        const links = record.getLinks(referenceFieldKey);

        // Get address fields from the address reference if customer is present
        if (links && links.length > 0) {
          // Get address values directly from the link, which is from the addresses sheet
          const streetValue = links?.[0]?.["streetLine1"];
          const streetLine2Value = links?.[0]?.["streetLine2"];
          const cityValue = links?.[0]?.["city"];
          const stateValue = links?.[0]?.["state"];
          const zipValue = links?.[0]?.["postalCode"];

          // Set address values if they exist
          if (streetValue) {
            record.set("street", streetValue);
          }

          if (streetLine2Value) {
            record.set("streetLine2", streetLine2Value);
          }

          if (cityValue) {
            record.set("city", cityValue);
          }

          if (stateValue) {
            record.set("state", stateValue);
          }

          if (zipValue) {
            record.set("zip", zipValue);
            record.addInfo("zip", "Zip code set based on customer address.");
          }
        }

        return record;
      });
    })
  );
}
