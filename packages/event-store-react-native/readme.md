# @schemeless/event-store-react-native

React Native compatible build of the [`@schemeless/event-store`](../event-store) runtime. It mirrors the Node.js implementation but swaps the internal queue implementation to [`react-native-better-queue`](https://github.com/YahyaASadiq/react-native-better-queue) so it can run inside React Native apps without relying on Node.js file system primitives.

## Usage

Install the package from npm and initialise it the same way you would the Node.js runtime:

```ts
import { makeEventStore } from '@schemeless/event-store-react-native';
```

All public APIs match the original package, so existing event flows and adapters can be reused. The only difference is the queue dependency, which now targets React Native environments.

## Development

This package is generated from the Node.js implementation and will be kept in sync as part of the monorepo. Build scripts and test commands mirror the original package:

```bash
yarn workspace @schemeless/event-store-react-native compile
yarn workspace @schemeless/event-store-react-native test
```

## License

MIT
