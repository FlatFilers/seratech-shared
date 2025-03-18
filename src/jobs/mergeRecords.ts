import api from "@flatfile/api";
import { jobHandler } from "@flatfile/plugin-job-handler";
import { Simplified } from "@flatfile/util-common";


export default jobHandler("sheet:mergeRecords", async ({ context }, tick) => {
  const { jobId, sheetId } = context;

  try {
    const updates = [];
    const delete_ids = [];

    const records = await Simplified.getAllRecords(sheetId);
    
    // Group records by invoice number
    const groupedRecords = new Map();
    records.forEach((record) => {
      const invoice = record.invoice;
      if (!invoice) return;
      
      if (!groupedRecords.has(invoice)) {
        groupedRecords.set(invoice, []);
      }
      groupedRecords.get(invoice).push(record);
    });

    // Merge records with same invoice
    groupedRecords.forEach((group) => {
      if (group.length <= 1) return;

      // Use first record as base and merge others into it
      const mergedRecord = { ...group[0] };
      
      // Create an array to collect all lineItems
      let allLineItems = [];
      if (mergedRecord.lineItems) {
        // Add base record's lineItems if they exist
        allLineItems = Array.isArray(mergedRecord.lineItems) 
          ? [...mergedRecord.lineItems] 
          : [mergedRecord.lineItems];
      }
      
      // Initialize total amount with the base record's amount (if it exists)
      let totalAmount = 0;
      if (mergedRecord.amount && !isNaN(parseFloat(mergedRecord.amount))) {
        totalAmount = parseFloat(mergedRecord.amount);
      }
      
      // Add remaining records' IDs to delete list and merge their fields
      for (let i = 1; i < group.length; i++) {
        const record = group[i];
        delete_ids.push(record._id);
        
        // Collect lineItems from this record if they exist
        if (record.lineItems) {
          const recordLineItems = Array.isArray(record.lineItems) 
            ? record.lineItems 
            : [record.lineItems];
          allLineItems = [...allLineItems, ...recordLineItems];
        }
        
        // Add this record's amount to the total (if it exists and is a number)
        if (record.amount && !isNaN(parseFloat(record.amount))) {
          totalAmount += parseFloat(record.amount);
        }
        
        // Go through all fields in the record
        Object.keys(record).forEach(field => {
          // Skip _id field since we want to keep the first record's ID
          // Also skip lineItems and amount as we're handling those separately
          if (field === '_id' || field === 'lineItems' || field === 'amount') return;
          
          // If field doesn't exist or is empty/null in merged record,
          // take value from current record
          if (!mergedRecord[field] && record[field]) {
            mergedRecord[field] = record[field];
          }
        });
      }
      
      // Set the concatenated lineItems on the merged record
      if (allLineItems.length > 0) {
        mergedRecord.lineItems = allLineItems;
      }
      
      // Set the total amount on the merged record (if there was at least one valid amount)
      if (totalAmount > 0) {
        mergedRecord.amount = totalAmount;
      }

      updates.push(mergedRecord);
    });
    if (updates.length > 0) {
      await Simplified.updateAllRecords(sheetId, updates as any);
    }
    if (delete_ids.length > 0) {
      await api.records.delete(sheetId, { ids: delete_ids });
    }
    await api.jobs.complete(jobId, { info: "Completed processing records" });
  } catch (error) {
    await api.jobs.fail(jobId, { info: "Failed processing records" });
  }
});
