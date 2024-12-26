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
        const isBilling = record.get("isBilling") as string;

        if (isBilling && isBilling === "Billing") {
          record.set("isBilling", true);
        } else {
          record.set("isBilling", null);
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
          const nameParts = trimmedName.split(' ');
          if (nameParts.length > 0) {
            record.set("firstName", nameParts[0]);
            if (nameParts.length > 1) {
              record.set("lastName", nameParts.slice(1).join(' '));
            }
          }
        }

        // Handle phone numbers
        const mobileNumber = record.get("mobileNumber") as string;
        console.log({mobileNumber})
        if (mobileNumber) {
          // Split by comma and map to array of phone numbers or null
          const phoneNumbers = mobileNumber.split(',')
            .map(num => {
              const trimmed = num.trim();
              return trimmed && trimmed !== ',' ? trimmed : null;
            })
            .filter(num => num !== undefined); // Keep null values but remove undefined

          // Find first two available numbers
          const validNumbers = phoneNumbers.filter(num => num !== null);
          
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

        const dateRegex = /([0-9]+\/[0-9]+\/[0-9][0-9] [0-2][0-9]:[0-5][0-9]$)/;
        const finishedRegex =
          /([0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-1][0-9]:[0-5][0-9](?:am|pm)$)/i;

        if (createdAt) {
          if (!dateRegex.test(createdAt)) {
            record.addError("createdAt", `Must be in M/d/yy HH:mm format`);
          }
        }
        if (date) {
          if (!dateRegex.test(date)) {
            record.addError("date", `Must be in M/d/yy HH:mm format`);
          }
        }
        if (finishedAt) {
          if (!finishedRegex.test(finishedAt)) {
            record.addError(
              "finished",
              `Must be in yyyy-mm-dd hh:mmam/pm format`
            );
          }
        }

        for (const field of leaveBlankFields) {
          if (record.get(field) as string) {
            record.addError(field, `${field} must be left blank`);
          }
        }

        for (const field of mustBeZeroFeilds) {
          if (record.get(field) !== 0) {
            record.addError(field, `${field} must be 0`);
          }
        }

        const referenceFieldKey = "customer";
        const links = record.getLinks(referenceFieldKey);
        const lookupFirstNameValue = links?.[0]?.["firstName"];
        const lookupLastNameValue = links?.[0]?.["lastName"];
        const lookupLastEmailValue = links?.[0]?.["email"];

        if (lookupFirstNameValue) {
          record.set("firstName", lookupFirstNameValue);
          record.addInfo("firstName", `firstName set based on customer.`);
        }

        if (lookupLastNameValue) {
          record.set("lastName", lookupLastNameValue);
          record.addInfo("lastName", `lastName set based on customer.`);
        }

        if (lookupLastEmailValue) {
          record.set("email", lookupLastEmailValue);
          record.addInfo("email", `email set based on customer.`);
        }

        return record;
      });
    })
  );
}
