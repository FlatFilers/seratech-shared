import type { FlatfileClient, FlatfileV2Record, RequestOptions } from "../client";
import type { Flatfile } from "@flatfile/api";

import { defaultsDeep } from "lodash";

export type InsertRecordsRequest = {
  sheetId?: Flatfile.SheetId;
  sheetSlug?: Flatfile.SheetSlug;
};

export class Records {
  protected readonly client: FlatfileClient;

  constructor(client: FlatfileClient) {
    this.client = client;
  }

  public async list<T = FlatfileV2Record[]>(
    workbookId: Flatfile.WorkbookId,
    request: Flatfile.GetRecordsRequest = {},
    requestOptions: RequestOptions = {},
  ): Promise<T> {
    return this.client.request<T>("/records.jsonl", {
      ...requestOptions,
      method: "GET",
      query: defaultsDeep({ workbookId, stream: true }, request, requestOptions.query),
    });
  }

  public async insert<T = FlatfileV2Record>(
    records: Omit<FlatfileV2Record, "__k">[],
    request: InsertRecordsRequest = {},
    requestOptions: RequestOptions = {},
  ): Promise<T> {
    if (request.sheetId || request.sheetSlug) {
      for (const record of records) {
        if (request.sheetId) record.__s = request.sheetId;
        if (request.sheetSlug) record.__n = request.sheetSlug;

        if (!record.__s && !record.__n) {
          throw new Error("Either `__s` (Sheet ID) or `__n` (Sheet Slug) must be provided in the Record Object.");
        }
      }
    }

    return this.client.request<T>("/records.jsonl", {
      ...requestOptions,
      method: "POST",
      body: `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    });
  }
}
