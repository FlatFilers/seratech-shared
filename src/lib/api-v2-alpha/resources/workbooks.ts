import type { FlatfileClient, RequestOptions } from "../client";
import type { Flatfile } from "@flatfile/api";

import { defaultsDeep } from "lodash";

export class Workbooks {
  protected readonly client: FlatfileClient;

  constructor(client: FlatfileClient) {
    this.client = client;
  }

  public async reset(workbookId: Flatfile.WorkbookId, requestOptions: RequestOptions = {}): Promise<boolean> {
    return this.client.request(`/workbooks/${workbookId}/reset`, {
      ...requestOptions,
      method: "POST",
      query: defaultsDeep({ snapshot: true }, requestOptions.query),
      body: "{}",
    });
  }
}
