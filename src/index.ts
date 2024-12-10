import api from "@flatfile/api";
import FlatfileListener from "@flatfile/listener";
import { dedupePlugin } from "@flatfile/plugin-dedupe";
import { jobHandler } from "@flatfile/plugin-job-handler";
import { FlatfileRecord, bulkRecordHook } from "@flatfile/plugin-record-hook";
import { configureSpace } from "@flatfile/plugin-space-configure";
import { processRecords } from "@flatfile/util-common";
import { stringify } from "csv-stringify/sync";
import * as fs from "node:fs";
import path from "node:path";
import { addresses, customers, invoices, locations } from "./blueprints/sheets";
import autoFix from "./jobs/autoFix";
import generateCustIds from "./jobs/generateCustIds";
import getAddresses from "./jobs/getAddresses";
import mergeRecords from "./jobs/mergeRecords";
import { instrumentRequests } from "./instrument.requests";

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
  // listener.use(xlsxExtractorPlugin());
  listener.use(dedupePlugin("dedupe", { on: "id" }));
  listener.use(
    configureSpace({
      workbooks: [
        {
          name: "Sera Workbook",
          sheets: [customers, addresses, invoices, locations],
          actions: [
            {
              operation: "submitActionBg",
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

  listener.use(
    jobHandler("workbook:submitActionBg", async (event, tick) => {
      try {
        await tick(10, "Starting Customers and Invoices download...");

        const { environmentId, spaceId, workbookId } = event.context;
        console.log({ environmentId, spaceId, workbookId });
        const { data: sheets } = await api.sheets.list({ workbookId });
        const customerSheet = sheets.find(
          (sheet) => sheet.slug === "customers"
        );
        const invoiceSheet = sheets.find((sheet) => sheet.slug === "invoices");

        const invFields = invoiceSheet.config.fields;
        const invHeader = invFields.map((field) => field.key);
        const invHeaderLabels = invFields.map((field) => field.label);
        const timestamp = new Date().toISOString();

        const invFileName = `${invoiceSheet.slug}-${timestamp}.csv`;
        const invFilePath = path.join("/tmp", invFileName);

        await tick(20, "Writing Invoices CSV headers...");
        const invHeaderContent = stringify([invHeaderLabels], {
          delimiter: ",",
        });
        fs.writeFileSync(invFilePath, invHeaderContent);

        await tick(30, "Writing Invoices CSV rows...");
        await processRecords(
          invoiceSheet.id,
          async (records, pageNumber, totalPageCount) => {
            const rows = records.map((record) =>
              invHeader.map((key) => record.values[key].value)
            );

            const invCsvContent = stringify(rows, {
              delimiter: ",",
            });
            fs.appendFileSync(invFilePath, invCsvContent);
          }
        );

        await tick(40, "Uploading Invoices CSV...");
        const invReader = fs.createReadStream(invFilePath);
        const { data: invExportFile } = await api.files.upload(invReader, {
          spaceId,
          environmentId,
          mode: "export",
        });

        await tick(50, "Writing Customers CSV headers...");
        const custFields = customerSheet.config.fields;
        const custHeader = custFields.map((field) => field.key);
        const custHeaderLabels = custFields.map((field) => field.label);

        const custFileName = `${customerSheet.slug}-${timestamp}.csv`;
        const custFilePath = path.join("/tmp", custFileName);

        await tick(60, "Writing Customers CSV headers...");
        const custHeaderContent = stringify([custHeaderLabels], {
          delimiter: ",",
        });
        fs.writeFileSync(custFilePath, custHeaderContent);

        await tick(70, "Writing Customers CSV rows...");
        await processRecords(
          customerSheet.id,
          async (records, pageNumber, totalPageCount) => {
            const rows = records.map((record) =>
              custHeader.map((key) => record.values[key].value)
            );

            const custCsvContent = stringify(rows, {
              delimiter: ",",
            });
            fs.appendFileSync(custFilePath, custCsvContent);
          }
        );

        await tick(80, "Uploading Customers CSV...");
        const custReader = fs.createReadStream(custFilePath);
        const { data: custExportFile } = await api.files.upload(custReader, {
          spaceId,
          environmentId,
          mode: "export",
        });

        await tick(90, "Successfully downloaded CSV files");

        return {
          outcome: {
            message: `Successfully downloaded CSV files`,
            next: {
              type: "files",
              files: [
                { fileId: invExportFile.id },
                { fileId: custExportFile.id },
              ],
            },
          },
        };
      } catch (error) {
        console.error("Error in submitActionBg job:", error);
        throw error;
      }
    })
  );

  listener.use(autoFix);
  listener.use(getAddresses);
  listener.use(generateCustIds);
  listener.use(mergeRecords);

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
