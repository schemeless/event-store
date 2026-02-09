# @schemeless/event-store-react-native

React Native compatible build of the [`@schemeless/event-store`](../event-store) runtime. It mirrors the Node.js implementation but swaps the internal queue implementation to [`react-native-better-queue`](https://github.com/YahyaASadiq/react-native-better-queue) so it can run inside React Native apps without relying on Node.js file system primitives.

## Usage

Install the package from npm and initialise it the same way you would the Node.js runtime:

```ts
import { makeEventStore } from '@schemeless/event-store-react-native';
```

All public APIs match the original package, so existing event flows and adapters can be reused. The only difference is the queue dependency, which now targets React Native environments.

### React Native prerequisites

Some consumers rely on `crypto.getRandomValues` (for example the `uuid` package). React Native apps should polyfill it with [`react-native-get-random-values`](https://github.com/Luka967/react-native-get-random-values):

```sh
npm install react-native-get-random-values
npx pod-install
```

If you use the Expo managed workflow you will see "CocoaPods is not supported in this project"—that is expected and safe to ignore.

Then import the polyfill once at the root of your app (e.g. `index.js`):

```js
import 'react-native-get-random-values';
```

After this, libraries that depend on `crypto.getRandomValues` (such as `uuid`) continue to work as expected.

## Development

This package is generated from the Node.js implementation and will be kept in sync as part of the monorepo. Build scripts and test commands mirror the original package:

```bash
yarn workspace @schemeless/event-store-react-native compile
yarn workspace @schemeless/event-store-react-native test
```

### Alignment notes

- Runtime behavior is aligned with `@schemeless/event-store`, except for queue internals that must use `react-native-better-queue`.
- Queue IDs use ULID slices instead of `uuid` to avoid forcing `crypto.getRandomValues` polyfills for internal queue naming.
- Some stress/integration suites are intentionally maintained only in the Node package (`snapshot`, `shutdown`, `revert`, sharded concurrency/stress), because they depend on Node-centric adapter and load characteristics.

## License

MIT
