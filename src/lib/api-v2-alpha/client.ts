import type { Flatfile } from "@flatfile/api";

import { defaultsDeep } from "lodash";
import qs from "node:querystring";
import { Records } from "./resources/records";
import { Workbooks } from "./resources/workbooks";

export interface RequestOptions extends RequestInit {
  query?: Record<string, any>;
}

type RecordMetadata = Record<string, any>;

export interface FlatfileV2Record extends Record<string, any> {
  __k?: Flatfile.RecordId; // Record ID
  __s?: Flatfile.SheetId; // Sheet ID
  __n?: Flatfile.SheetSlug; // Sheet Slug
  __m?: RecordMetadata; // Metadata
  __l?: FlatfileV2Record[]; // Linked Records
  __x?: string; // Linked Field Key
}

export class FlatfileClient {
  private baseURL =
    process.env.AGENT_INTERNAL_URL || process.env.FLATFILE_API_URL || "https://platform.flatfile.com/api";

  protected _records: Records | undefined;
  public get records(): Records {
    return (this._records ??= new Records(this));
  }

  protected _workbooks: Workbooks | undefined;
  public get workbooks(): Workbooks {
    return (this._workbooks ??= new Workbooks(this));
  }

  /**
   * request
   *
   * Makes an API request to the Flatfile v2-alpha API. Supports both JSON and JSONL responses, parsed
   * based on the `Content-Type` header or the endpoint extension (.jsonl/.json).
   *
   * @param {string} endpoint - The API endpoint to request (ex. '/records').
   * @param {RequestOptions} options - The request options.
   * @returns {Promise<T>} - The response data.
   */
  async request<T = FlatfileV2Record>(endpoint: string, options?: RequestOptions): Promise<T> {
    const query = options?.query ? `?${qs.stringify(options.query)}` : "";
    const defaultOptions = {
      headers: {
        Authorization: `Bearer ${process.env.FLATFILE_API_KEY || process.env.FLATFILE_BEARER_TOKEN}`,
        "Content-Type": "application/jsonl",
        "X-User-Agent": "Kainos @lib/flatfile/api-v2-alpha (v1.0.0)",
      },
    };
    const requestOptions = defaultsDeep(options, defaultOptions);
    const response = await fetch(`${this.baseURL}/v2-alpha${endpoint}${query}`, requestOptions);

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Request Error (${response.status} ${response.statusText}): ${message}`);
    }

    const rawBody = await response.text();
    let records: T;

    if (requestOptions?.headers?.["Content-Type"] === "application/jsonl" || endpoint.endsWith(".jsonl")) {
      records = rawBody
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line)) as T;
    } else if (requestOptions?.headers?.["Content-Type"] === "application/json" || endpoint.endsWith(".json")) {
      records = JSON.parse(rawBody) as T;
    } else {
      records = rawBody as unknown as T;
    }

    return records;
  }
}

export default FlatfileClient;
