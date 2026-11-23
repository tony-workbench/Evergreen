// The deterministic stand-in for the model that the tests and scripts/demo.mjs use. The rules live in
// src/agent/demo-model.mjs, because the phone bundle also exposes them as memoryDemoModel for the contract's week test.
export { demoModel as fakeModel } from '../src/agent/demo-model.mjs';
