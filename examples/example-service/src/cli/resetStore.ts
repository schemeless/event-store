import { resetDb } from './utils';

const main = async () => {
  await resetDb();
  process.exit(0);
};

main();
