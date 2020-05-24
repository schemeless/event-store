import { replayStore } from './utils';

const main = async () => {
  await replayStore();
  process.exit(0);
};

main();
