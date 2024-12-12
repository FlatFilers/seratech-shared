import { randomUUID } from "node:crypto";
import * as util from "util";
import {
  asBool,
  asDate,
  asNullableString,
  asNumber,
  asString,
} from "../../utils/casting";
import { isPresent } from "../../utils/is.nullish";
import { Primitive, SimpleRecord } from "@flatfile/util-common";
import { Flatfile } from "@flatfile/api";

export const HASH_PROP_DELIM = "|";
export const HASH_VALUE_DELIM = ":";

export class Item<T extends Record<string, any> = Record<string, any>> {
  private _changes: Map<string, any> = new Map();
  private _errs: Map<string, Set<string>> = new Map();
  private _metadata: Record<string, any>;

  private _deleted = false;
  private _tempId?: string;

  private _info: Map<any, Set<string>> = new Map();
  private _warns: Map<any, Set<string>> = new Map();

  constructor(public data: Readonly<Partial<T>>, dirty = false) {
    this._metadata = data.__m || {};

    if (dirty) {
      this.data = Object.freeze({});
      Object.entries(data).forEach(([key, value]) => {
        this.set(key, value);
      });
    } else {
      Object.freeze(this.data);
    }
  }

  get id() {
    return this.data.__k || this._tempId;
  }

  get meta(): Record<string, any> {
    return this._metadata;
  }

  get slug() {
    return this.data.__n;
  }

  get sheetId() {
    return this.data.__s;
  }

  getLinks(key?: string) {
    if (key) {
      return this.data.__l?.filter((link) => link.__x === key) || [];
    }
    return this.data.__l || [];
  }

  set(key: string, value: any) {
    if (this.data[key] === value) {
      this._changes.delete(key);
      return;
    }
    this._changes.set(key, value);
    return this;
  }

  flag(key: string) {
    this.set(key, true);
  }

  unflag(key: string) {
    this.set(key, false);
  }

  get(key: string) {
    if (this._changes.has(key)) {
      return this._changes.get(key);
    }
    return this.data[key];
  }

  has(key: string) {
    return isPresent(this.get(key));
  }

  hasAny(...keys: string[]) {
    return keys.some((k) => this.has(k));
  }

  hasAll(...keys: string[]) {
    return keys.every((k) => this.has(k));
  }

  isEmpty(key: string) {
    return !this.has(key);
  }

  keys(options?: { omit?: string[]; pick?: string[] }): string[] {
    const set = new Set<string>(
      Object.keys(this.data).filter((key) => !key.startsWith("__"))
    );

    for (const key of this._changes.keys()) {
      if (!key.startsWith("__")) {
        set.add(key);
      }
    }
    const res = Array.from(set);

    if (options?.omit) {
      return res.filter((key) => !options.omit.includes(key));
    }
    if (options?.pick) {
      return res.filter((key) => options.pick.includes(key));
    }
    return res;
  }

  keysWithData(props?: { exclude?: Array<string | string[]> }): string[] {
    const keys = this.keys().filter((k) => this.has(k));
    if (props?.exclude) {
      const f = props.exclude.flat();
      return keys.filter((k) => !f.includes(k));
    }
    return keys;
  }

  /**
   * Intersects exactly with another item on the keys
   *
   * @param item
   * @param keys
   */
  intersects(item: Item, keys: string[]) {
    return keys.every((key) => {
      const value1 = this.str(key);
      const value2 = item.str(key);
      return value1 === value2;
    });
  }

  hash(...keys: string[]) {
    return keys
      .map((k) => [k, this.get(k)])
      .map(([k, v]) => `${k}${HASH_VALUE_DELIM}${asString(v)}`)
      .join(HASH_PROP_DELIM);
  }

  isDirty(key?: string): boolean {
    if (key) {
      return (
        this._changes.has(key) ||
        this._errs.get(key)?.size > 0 ||
        this._info.get(key)?.size > 0 ||
        this._warns.get(key)?.size > 0
      );
    }
    return (
      this._changes.size > 0 ||
      this._errs.size > 0 ||
      this._info.size > 0 ||
      this._warns.size > 0 ||
      this._deleted
    );
  }

  eachOfKeysPresent(
    keys: string[],
    callback: (key: string, value: any) => void
  ) {
    for (const key of keys) {
      if (this.has(key)) {
        callback(key, this.get(key));
      }
    }
  }

  isDeleted(): boolean {
    return this._deleted;
  }

  delete() {
    this._deleted = true;
  }

  str(key: string) {
    return asNullableString(this.get(key));
  }

  defStr(key: string): string {
    return asString(this.get(key));
  }

  bool(key: string) {
    return asBool(this.get(key));
  }

  num(key: string) {
    return asNumber(this.get(key));
  }

  date(key: string) {
    return asDate(this.get(key));
  }

  pick(...keys: string[]) {
    const obj: Record<string, any> = {};
    for (const key of keys) {
      obj[key] = this.get(key);
    }
    return obj;
  }

  err(key: string, msg: string) {
    if (!this._errs.has(key)) {
      this._errs.set(key, new Set([msg]));
    }
    this._errs.get(key).add(msg);
    return this;
  }

  values(castAs?: CastingMethod) {
    if (!castAs) {
      return Object.fromEntries(this.entries());
    }

    return Object.fromEntries(
      this.keys().map((key) => [key, this[castAs](key)])
    );
  }

  entries() {
    return this.keys().map((key) => [key, this.get(key)]);
  }

  merge(item: Item, props: { overwrite?: boolean } = {}) {
    for (const key of item.keys()) {
      if (props.overwrite) {
        this.set(key, item.get(key));
      } else if (!this.has(key)) {
        this.set(key, item.get(key));
      }
    }
    return this;
  }

  hasConflict(b: Item, keys?: string[]) {
    if (keys) {
      return keys.some((key) => {
        const aValue = this.get(key);
        const bValue = b.get(key);
        return aValue && bValue && aValue !== bValue;
      });
    }
    return this.entries().some(([key, aValue]) => {
      const bValue = b.get(key);
      return aValue && bValue && aValue !== bValue;
    });
  }

  toJSON() {
    return { ...this.data, ...this.changeset() };
  }

  toSimpleRecord(): SimpleRecord {
    return {
      _id: this.id,
      ...this.values(),
    };
  }

  [util.inspect.custom]() {
    return `${this._deleted ? "❌ " : ""}${this.slug || this.sheetId}(${
      this.id ?? "new"
    }) ${JSON.stringify(this.values(), null, "  ")} ${JSON.stringify(
      this.getLinks(),
      null,
      "  "
    )}`;
  }

  copy(
    props: {
      mixin?: Item;
      select?: string[];
      slug?: string;
      sheetId?: string;
    } = {}
  ) {
    const newObj = new Item({});
    newObj._tempId = `TEMP_${randomUUID()}`;
    if (props.slug) {
      newObj.set("__n", props.slug);
    }
    if (props.sheetId) {
      newObj.set("__s", props.sheetId);
    }
    if (props.select) {
      for (const key of props.select) {
        newObj.set(key, props.mixin?.get(key) ?? this.get(key));
      }
    } else {
      for (const key in this.data) {
        if (!key.startsWith("__")) {
          newObj.set(key, this.get(key));
        }
      }
      if (props.mixin) {
        for (const key in props.mixin.data) {
          if (!key.startsWith("__")) {
            newObj.set(key, props.mixin.get(key));
          }
        }
      }
    }
    return newObj;
  }

  commit() {
    // reset the data object with new changes and unset all pending changes
    const newObj: Record<string, any> = Object.assign({}, this.data);
    for (const [key, value] of this._changes) {
      newObj[key] = value;
    }
    this._changes.clear();
    if (this._errs.size) {
      newObj.__i = [];
      for (const [key, errs] of this._errs) {
        for (const err of errs) {
          newObj.__i.push({ x: key, m: err });
        }
      }
    }
    this._errs.clear();

    if (this._info.size) {
      newObj.__i = newObj.__i || [];
      for (const [key, errs] of this._info) {
        for (const err of errs) {
          newObj.__i.push({ x: key, m: err, t: "info" });
        }
      }
    }
    this._info.clear();

    if (this._warns.size) {
      newObj.__i = newObj.__i || [];
      for (const [key, errs] of this._warns) {
        for (const err of errs) {
          newObj.__i.push({ x: key, m: err, t: "warn" });
        }
      }
    }
    this._warns.clear();

    this.data = Object.freeze(newObj) as any;
  }

  changeset() {
    const val = Object.fromEntries(this._changes);
    val.__k = this.get("__k");
    val.__s = this.get("__s");
    val.__n = this.get("__n");
    val.__i = [];

    if (this._deleted) {
      val.__d = true;
    }
    if (this._errs.size) {
      if (!val.__i) {
        val.__i = [];
      }
      for (const [key, errs] of this._errs) {
        for (const err of errs) {
          val[key] = this.get(key);
          val.__i.push({ x: key, m: err });
        }
      }
    }
    if (this._info.size) {
      for (const [key, errs] of this._info) {
        for (const err of errs) {
          val[key] = this.get(key);
          val.__i.push({ x: key, m: err, t: "info" });
        }
      }
    }
    if (this._warns.size) {
      for (const [key, errs] of this._warns) {
        for (const err of errs) {
          val[key] = this.get(key);
          val.__i.push({ x: key, m: err, t: "warn" });
        }
      }
    }
    return val;
  }

  /**
   * @deprecated use .err() instead
   */
  addError(key: string, msg: string) {
    return this.err(key, msg);
  }

  hasError(...keys: string[]) {
    if (keys.length > 0) {
      return keys.some(
        (key) => this._errs.has(key) && this._errs.get(key).size > 0
      );
    }
    return this._errs.size > 0;
  }

  errorFields(...keys: string[]) {
    if (keys.length > 0) {
      return keys.filter(
        (key) => this._errs.has(key) && this._errs.get(key).size > 0
      );
    }
    return Array.from(this._errs.keys());
  }

  errorIf(key: string, cb: (val: any) => any, err: string) {
    if (cb(this.get(key))) {
      this.err(key, err);
    }
  }

  info(key: string, msg: string) {
    if (!this._info.has(key)) {
      this._info.set(key, new Set([msg]));
    }
    this._info.get(key).add(msg);
    return this;
  }

  /**
   * @deprecated use .info() instead
   */
  addComment(key: string, msg: string) {
    return this.info(key, msg);
  }

  /**
   * @deprecated use .info() instead
   */
  addInfo(key: string, msg: string) {
    return this.info(key, msg);
  }

  warn(key: string, msg: string) {
    if (!this._warns.has(key)) {
      this._warns.set(key, new Set([msg]));
    }
    this._warns.get(key).add(msg);
    return this;
  }

  /**
   * @deprecated use .warn() instead
   */
  addWarning(key: string, msg: string) {
    return this.warn(key, msg);
  }

  setReadOnly(key: string) {
    this.setFieldConfig(key, { readonly: true });
  }

  setConfig(setter: (config: Flatfile.RecordConfig) => Flatfile.RecordConfig) {
    const baseConfig = this.data.__c || {};
    this._changes.set("__c", setter(baseConfig));
  }

  setFieldConfig(key: string, newConfig: Flatfile.CellConfig) {
    this.setConfig((config) => {
      config.fields = config.fields || {};
      const baseConfig = config.fields[key as string] || {};
      config.fields[key as string] = { ...baseConfig, ...newConfig };
      return config;
    });
  }
}

type AnyRecord = {
  [k: string]: any;
};

type TerseRecord = {
  __k: string;
  __s?: string;
  __n?: string;
  __l?: AnyRecord[];
} & {
  [k: string]: Primitive;
};

type CastingMethod = "str" | "defStr" | "bool" | "num" | "date";
