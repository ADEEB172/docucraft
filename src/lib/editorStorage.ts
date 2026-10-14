const databaseName = "docucraft-editor";
const storeName = "savedStates";

type StoredEditorState = {
  key: string;
  value: unknown;
};

function openEditorDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Browser database storage is not available."));
      return;
    }

    const request = indexedDB.open(databaseName, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open browser database storage."));
    request.onblocked = () =>
      reject(new Error("Browser database storage is blocked by another tab."));
  });
}

export async function loadEditorStateFromIndexedDb(
  key: string,
): Promise<unknown | null> {
  const database = await openEditorDatabase();

  try {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);

    return await new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const result: unknown = request.result;
        if (
          typeof result === "object" &&
          result !== null &&
          "value" in result
        ) {
          resolve(result.value);
          return;
        }

        resolve(null);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Could not read saved editor state."));
    });
  } finally {
    database.close();
  }
}

export async function saveEditorStateToIndexedDb(
  key: string,
  value: unknown,
): Promise<void> {
  const database = await openEditorDatabase();

  try {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put({ key, value } satisfies StoredEditorState);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ?? new Error("Could not save editor changes."),
        );
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Saving editor changes was stopped."));
    });
  } finally {
    database.close();
  }
}

export async function deleteEditorStateFromIndexedDb(
  key: string,
): Promise<void> {
  const database = await openEditorDatabase();

  try {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ?? new Error("Could not remove saved editor state."),
        );
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Removing saved editor state was stopped."));
    });
  } finally {
    database.close();
  }
}
