import api from "@flatfile/api";
import { jobHandler } from "@flatfile/plugin-job-handler";
import { Simplified } from "@flatfile/util-common";

export default jobHandler("sheet:generateCustIds", async ({ context }, tick) => {
  const { jobId, sheetId, workbookId } = context;

  try {
    const updates = [];
    let processedCount = 0;

    const records = await Simplified.getAllRecords(sheetId);
    const { data: job } = await api.jobs.get(jobId);
    const input = job.input;
    const name = input.name;

    // Keep track of the highest sequence per baseId
    const baseIdMaxSeq = new Map<string, bigint>();

    // First pass: find the highest sequence for each baseId
    records.forEach((record) => {
      const id = record.id?.toString() || '';
      if (id) {
        const baseId = id.slice(0, 5);
        const seqStr = id.slice(5);
        const seq = seqStr ? BigInt(seqStr) : BigInt(0);
        const currentMax = baseIdMaxSeq.get(baseId) || BigInt(0);
        if (seq > currentMax) {
          baseIdMaxSeq.set(baseId, seq);
        }
      }
    });

    // Process records in chunks to avoid memory issues
    for (const record of records) {
      const newRecord: Record<string, any> = { _id: record._id };
      let updateRecord = false;

      const customerId = record.id;
      if (!customerId) {
        const firstName = record.firstName as string || '';
        const numpadMap: {[key: string]: string} = {
          'a': '2', 'b': '2', 'c': '2',
          'd': '3', 'e': '3', 'f': '3', 
          'g': '4', 'h': '4', 'i': '4',
          'j': '5', 'k': '5', 'l': '5',
          'm': '6', 'n': '6', 'o': '6',
          'p': '7', 'q': '7', 'r': '7', 's': '7',
          't': '8', 'u': '8', 'v': '8',
          'w': '9', 'x': '9', 'y': '9', 'z': '9'
        };
        
        // Get first 5 chars of firstName and convert to numpad numbers
        const baseId = name.toLowerCase().slice(0,5)
          .split('')
          .map(c => numpadMap[c] || '0')
          .join('');

        // Get the next sequence number for this baseId
        let nextSeq = (baseIdMaxSeq.get(baseId) || BigInt(0)) + BigInt(1);
        baseIdMaxSeq.set(baseId, nextSeq);

        // Create the new ID by concatenating baseId and sequence
        const seqStr = nextSeq.toString();
        newRecord["id"] = baseId + (seqStr.length <= 3 ? seqStr.padStart(3, '0') : seqStr);
        updateRecord = true;
        processedCount++;
      }
      if (updateRecord) {
        updates.push(newRecord);
      }
    }

    // Update records in chunks to avoid memory issues
    const chunkSize = 1000;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      await Simplified.updateAllRecords(sheetId, chunk as any);
    }

    await api.jobs.complete(jobId, { 
      info: `Completed processing ${processedCount} records` 
    });
  } catch (error) {
    console.error('Error in generateCustIds:', error);
    await api.jobs.fail(jobId, { 
      info: `Failed processing records: ${error.message}` 
    });
    throw error;
  }
});
