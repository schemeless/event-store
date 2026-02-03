import { DataSource, DataSourceOptions, EntitySchema } from 'typeorm';

const dataSourceMap = new Map<string, DataSource>();

export const getConnection = async (
  entities: (Function | string | EntitySchema<any>)[],
  options?: DataSourceOptions
) => {
  const name = (options as any).name || 'default';

  let dataSource = dataSourceMap.get(name);

  if (dataSource) {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
    return dataSource;
  }

  dataSource = new DataSource({
    ...options,
    entities,
  });

  await dataSource.initialize();
  dataSourceMap.set(name, dataSource);
  return dataSource;
};
