import { FlatfileListener } from "@flatfile/listener";

export function demo(customer: string, cb: (listener: FlatfileListener) => void) {
  return function (listener: FlatfileListener) {
    listener.namespace(`space:${customer}`, (ns) => {
      cb(ns);
    });
  };
}
