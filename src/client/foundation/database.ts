import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/** Settle a failed write without replacing its original error with an abort error. */
export async function abortTransaction(transaction: { abort(): void; done: Promise<unknown> }) {
  try {
    transaction.abort();
  } catch {}
  await transaction.done.catch(() => {});
}

// Share one connection per store, including concurrent first reads. A rejected
// open or browser-terminated connection must remain recoverable on the next use.
export function localDatabase<T extends DBSchema>(
  name: string,
  version: number,
  upgrade: (db: IDBPDatabase<T>) => void,
) {
  let pending: Promise<IDBPDatabase<T>> | undefined;

  return () => {
    if (!pending) {
      const opening = openDB<T>(name, version, {
        upgrade,
        blocking() {
          void opening.then((db) => db.close());
          if (pending === opening) {
            pending = undefined;
          }
        },
        terminated() {
          if (pending === opening) {
            pending = undefined;
          }
        },
      });
      pending = opening;
      void opening.catch(() => {
        if (pending === opening) {
          pending = undefined;
        }
      });
    }

    return pending;
  };
}
