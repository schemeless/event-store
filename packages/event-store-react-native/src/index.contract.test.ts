import * as nodeRuntime from '@schemeless/event-store';
import * as reactNativeRuntime from './index';

describe('public runtime exports', () => {
  it('stays aligned with @schemeless/event-store export keys', () => {
    const nodeKeys = Object.keys(nodeRuntime).sort();
    const reactNativeKeys = Object.keys(reactNativeRuntime).sort();

    expect(reactNativeKeys).toEqual(nodeKeys);
  });
});
