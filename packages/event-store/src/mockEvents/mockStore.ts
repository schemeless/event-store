interface Store {
  [key: string]: number;
}

let store: Store = {};

export const storeSet = (key: string, num: number) => (store[key] = num);

export const storeGet = (key: string) => store[key];
