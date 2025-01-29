import { JobOutcome } from "@flatfile/api/api";
import { Collection } from "collect.js";
import { safe } from "./requests";
import { Item } from "./requests/records/item";
import { TriggeredBy, WorkbookJobWorker } from "./utils/job.worker";
import api from "@flatfile/api";
import path from "path";
import os from "os";
import fs from "fs";
import * as XLSX from "xlsx";

@TriggeredBy("export-xlsx")
export class ExportXlsxWorker extends WorkbookJobWorker {
  async execute(): Promise<void | JobOutcome> {
    const records = await safe.records.stream({
      workbookId: this.workbookId,
    });

    // Generate both files
    const customerExport = await this.generateCsvFile(
      "customers",
      await this.prepareData(records)
    );
    const invoiceExport = await this.generateCsvFile(
      "invoices",
      await this.prepareInvoicesData(records)
    );

    // Upload both files
    const [custExportFile, invExportFile] = await Promise.all([
      this.uploadFile(customerExport),
      this.uploadFile(invoiceExport),
    ]);

    return {
      message: `Successfully downloaded Excel files`,
      next: {
        type: "files",
        files: [{ fileId: custExportFile.id }, { fileId: invExportFile.id }],
      },
    };
  }

  private async uploadFile(filePath: string) {
    const { data: exportFile } = await api.files.upload(
      fs.createReadStream(filePath),
      {
        spaceId: this.spaceId,
        environmentId: this.environmentId,
        mode: "export",
      }
    );
    return exportFile;
  }

  private async generateCsvFile(
    type: string,
    { data, headers }: { data: Record<string, any>[]; headers: string[] }
  ): Promise<string> {
    // Format data as array of arrays (including headers)
    const formattedData = [
      headers,
      ...data.map((row) => headers.map((header) => row[header] ?? "")),
    ];

    // Create Excel workbook and worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(formattedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

    const fileName = `${type}_export_${
      new Date().toISOString().replace('T', '_').split('.')[0]
    }.xlsx`;
    const tempDir = os.tmpdir();

    // Ensure tmp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.join(tempDir, fileName);

    // Write Excel file
    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
      bookSST: false,
    });
    fs.writeFileSync(tempFilePath, buffer);

    return tempFilePath;
  }

  private async getSheetConfig(sheetId: string) {
    const { data: sheet } = await api.sheets.get(sheetId);
    return {
      fields: sheet.config.fields.filter(
        (field) => !field.key.startsWith("__")
      ),
      fieldLabels: new Map(
        sheet.config.fields
          .filter((field) => !field.key.startsWith("__"))
          .map((field) => [field.key, field.label])
      ),
    };
  }

  private async prepareInvoicesData(records: Collection<Item>) {
    const invoiceRecords = records.forSheet("invoices");

    if (invoiceRecords.isEmpty()) {
      return { data: [], headers: [] };
    }

    const { fields } = await this.getSheetConfig(
      invoiceRecords.first().get("__s")
    );

    const data = invoiceRecords
      .map((record) => {
        const recordData = record.toJSON();
        return Object.fromEntries(
          fields.map((field) => [field.label, recordData[field.key]])
        );
      })
      .toArray();

    const headers = fields.map((field) => field.label);
    return { data, headers };
  }

  private async prepareData(records: Collection<Item>) {
    const customerRecords = new Map<string, Record<string, any>>();
    const customerData = records.forSheet("customers");
    const addressData = records.forSheet("addresses");

    // Get sheet configurations
    const { fields: customerFields } = await this.getSheetConfig(
      customerData.first().get("__s")
    );
    const { fields: addressFields } = await this.getSheetConfig(
      addressData.first().get("__s")
    );

    const processedAddressFields = addressFields
      .filter(
        (field) => field.key !== "customerId" && field.key !== "refDisplayName"
      )
      .map((field) => ({ key: field.key, label: field.label }));

    // Process customer records
    customerData.each((record) => {
      const recordData = record.toJSON();
      const customerId = record.get("id");
      if (!customerId) return;

      customerRecords.set(
        customerId,
        Object.fromEntries(
          customerFields.map((field) => [field.label, recordData[field.key]])
        )
      );
    });

    // Process address records
    addressData.each((record) => {
      const customerId = record.get("customerId");
      if (!customerId) return;

      const customerRecord = customerRecords.get(customerId);
      if (!customerRecord) {
        throw new Error(
          `Customer record not found for address record ${record.id}`
        );
      }

      let addressIndex = 1;
      while (
        customerRecord[
          `Address_${addressIndex} ${processedAddressFields[0].label}`
        ] !== undefined
      ) {
        addressIndex++;
      }

      processedAddressFields.forEach(({ key, label }) => {
        customerRecord[`Address_${addressIndex} ${label}`] = record.get(key);
      });
    });

    const data = Array.from(customerRecords.values());
    const baseHeaders = customerFields.map((field) => field.label);
    const addressHeaders = new Set<string>();

    data.forEach((record) => {
      Object.keys(record).forEach((key) => {
        if (key.startsWith("Address_")) {
          addressHeaders.add(key);
        }
      });
    });

    const headers = [
      ...baseHeaders,
      ...Array.from(addressHeaders).sort((a, b) => {
        const [, aIndex] = a.match(/^Address_(\d+)/) || [];
        const [, bIndex] = b.match(/^Address_(\d+)/) || [];
        const indexDiff = parseInt(aIndex) - parseInt(bIndex);
        if (indexDiff !== 0) return indexDiff;

        // Find the field labels without the Address_N prefix
        const aField = a.replace(/^Address_\d+\s/, "");
        const bField = b.replace(/^Address_\d+\s/, "");

        // Find the position of these fields in the original template
        const aPosition = processedAddressFields.findIndex(
          (f) => f.label === aField
        );
        const bPosition = processedAddressFields.findIndex(
          (f) => f.label === bField
        );

        // Sort by the original template order
        return aPosition - bPosition;
      }),
    ];

    return { data, headers };
  }
}
